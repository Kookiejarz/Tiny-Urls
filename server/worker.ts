import type { ExportedHandler } from '@cloudflare/workers-types';
import type { ExpirationOption, UrlRecord } from '../shared/urlTypes';

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ALLOWED_ORIGINS?: string;
  PUBLIC_BASE_URL?: string;
}

const JSON_CONTENT_HEADERS = {
  'Content-Type': 'application/json',
} as const;

const CORS_BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  Vary: 'Origin',
} as const;

const SHORT_PATH_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_SHORT_PATH_ATTEMPTS = 10;

const cacheKeyForShortPath = (shortPath: string) => `short:${shortPath}`;

const getExpirationTime = (option: ExpirationOption, now: number): number | null => {
  switch (option) {
    case '12h':
      return now + 12 * 60 * 60 * 1000;
    case '7d':
      return now + 7 * 24 * 60 * 60 * 1000;
    case 'forever':
      return null;
  }
};

const buildCorsHeaders = (allowedOrigin: string) => ({
  ...CORS_BASE_HEADERS,
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Max-Age': '600',
});

const normalizeOrigin = (value: string) => value.replace(/\/+$/, '');

const parseAllowedOrigins = (env: Env, fallbackOrigin: string): string[] => {
  const configured = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',')
        .map((origin) => normalizeOrigin(origin.trim()))
        .filter(Boolean)
    : [];

  if (configured.length === 0) {
    return [normalizeOrigin(fallbackOrigin)];
  }

  return configured;
};

const resolveAllowedOrigin = (request: Request, env: Env, fallbackOrigin: string): string | null => {
  const allowedOrigins = parseAllowedOrigins(env, fallbackOrigin);

  if (allowedOrigins.includes('*')) {
    return '*';
  }

  const requestOrigin = request.headers.get('Origin');

  if (requestOrigin) {
    if (requestOrigin === 'null') {
      return null;
    }
    const normalizedOrigin = normalizeOrigin(requestOrigin);

    if (allowedOrigins.includes(normalizedOrigin)) {
      return normalizedOrigin;
    }

    if (!env.ALLOWED_ORIGINS) {
      try {
        const parsed = new URL(requestOrigin);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return normalizedOrigin;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  return allowedOrigins[0] ?? null;
};

const getPublicBaseUrl = (env: Env, requestUrl: URL) =>
  env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || requestUrl.origin;

const jsonResponse = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_CONTENT_HEADERS,
      ...(headers || {}),
    },
  });

const handleOptions = (corsHeaders: HeadersInit) =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

const putInCache = async (env: Env, record: UrlRecord, now: number) => {
  const ttl = record.expiresAt ? Math.max(Math.floor((record.expiresAt - now) / 1000), 1) : undefined;
  const options = ttl ? { expirationTtl: ttl } : undefined;
  await env.CACHE.put(cacheKeyForShortPath(record.shortPath), JSON.stringify(record), options);
};

const deleteFromCache = (env: Env, shortPath: string) =>
  env.CACHE.delete(cacheKeyForShortPath(shortPath));

const getCachedUrl = async (env: Env, shortPath: string): Promise<UrlRecord | null> => {
  const cached = await env.CACHE.get<UrlRecord>(cacheKeyForShortPath(shortPath), 'json');
  return cached ?? null;
};

const generateRandomShortPath = () => {
  let result = '';
  for (let i = 0; i < 4; i++) {
    const randomIndex = Math.floor(Math.random() * SHORT_PATH_CHARSET.length);
    result += SHORT_PATH_CHARSET[randomIndex];
  }
  return result;
};

const fetchUrlFromDatabase = async (env: Env, shortPath: string): Promise<UrlRecord | null> => {
  const result = await env.DB.prepare(
    'SELECT shortPath, originalUrl, createdAt, expiresAt FROM urls WHERE shortPath = ? LIMIT 1'
  )
    .bind(shortPath)
    .first<UrlRecord | null>();

  return result ?? null;
};

const removeUrl = async (env: Env, shortPath: string) => {
  await env.DB.prepare('DELETE FROM urls WHERE shortPath = ?')
    .bind(shortPath)
    .run();
  await deleteFromCache(env, shortPath);
};

const cleanupExpiredUrls = async (env: Env, now: number) => {
  await env.DB.prepare('DELETE FROM urls WHERE expiresAt IS NOT NULL AND expiresAt <= ?')
    .bind(now)
    .run();
};

const ensureShortPathAvailable = async (env: Env, shortPath: string, now: number) => {
  const existing = await fetchUrlFromDatabase(env, shortPath);
  if (!existing) {
    return;
  }

  if (existing.expiresAt && now > existing.expiresAt) {
    await removeUrl(env, shortPath);
    return;
  }

  throw new Error('SHORT_PATH_TAKEN');
};

const findExistingUrl = async (env: Env, originalUrl: string, now: number): Promise<UrlRecord | null> => {
  const existing = await env.DB.prepare(
    'SELECT shortPath, originalUrl, createdAt, expiresAt FROM urls WHERE originalUrl = ? AND (expiresAt IS NULL OR expiresAt > ?) LIMIT 1'
  )
    .bind(originalUrl, now)
    .first<UrlRecord | null>();

  if (!existing) {
    return null;
  }

  await putInCache(env, existing, now);
  return existing;
};

const createShareLink = async (
  env: Env,
  originalUrl: string,
  expiration: ExpirationOption,
  now: number
) => {
  const existing = await findExistingUrl(env, originalUrl, now);
  if (existing) {
    return { record: existing, isExisting: true as const };
  }

  const expiresAt = getExpirationTime(expiration, now);

  for (let attempt = 0; attempt < MAX_SHORT_PATH_ATTEMPTS; attempt++) {
    const shortPath = generateRandomShortPath();

    try {
      await ensureShortPathAvailable(env, shortPath, now);

      await env.DB.prepare(
        'INSERT INTO urls (shortPath, originalUrl, createdAt, expiresAt) VALUES (?, ?, ?, ?)'
      )
        .bind(shortPath, originalUrl, now, expiresAt)
        .run();

      const record: UrlRecord = {
        shortPath,
        originalUrl,
        createdAt: now,
        expiresAt,
      };

      await putInCache(env, record, now);

      return { record, isExisting: false as const };
    } catch (error) {
      if (error instanceof Error && error.message === 'SHORT_PATH_TAKEN') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('SHORT_PATH_GENERATION_FAILED');
};

const getUrlRecord = async (env: Env, shortPath: string, now: number): Promise<UrlRecord | null> => {
  const cached = await getCachedUrl(env, shortPath);
  if (cached) {
    if (cached.expiresAt && now > cached.expiresAt) {
      await removeUrl(env, shortPath);
      return null;
    }
    return cached;
  }

  const record = await fetchUrlFromDatabase(env, shortPath);
  if (!record) {
    return null;
  }

  if (record.expiresAt && now > record.expiresAt) {
    await removeUrl(env, shortPath);
    return null;
  }

  await putInCache(env, record, now);
  return record;
};

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const now = Date.now();

    ctx.waitUntil(cleanupExpiredUrls(env, now));

    if (pathname.startsWith('/api/')) {
      const allowedOrigin = resolveAllowedOrigin(request, env, url.origin);

      if (!allowedOrigin) {
        if (request.method === 'OPTIONS') {
          return handleOptions({
            ...CORS_BASE_HEADERS,
          });
        }

        return jsonResponse(
          { error: 'Origin not allowed' },
          403,
          {
            ...CORS_BASE_HEADERS,
          }
        );
      }

      const corsHeaders = buildCorsHeaders(allowedOrigin);
      const apiJson = (body: unknown, status = 200, extra?: HeadersInit) =>
        jsonResponse(body, status, {
          ...corsHeaders,
          ...(extra || {}),
        });

      if (request.method === 'OPTIONS') {
        return handleOptions(corsHeaders);
      }

      if (request.method === 'POST' && pathname === '/api/share') {
        try {
          const body = (await request.json()) as {
            url?: string;
            expiration?: ExpirationOption;
          };

          const originalUrl = body.url?.trim();
          const expiration = body.expiration ?? '7d';

          if (!originalUrl) {
            return apiJson({ error: 'Missing url' }, 400);
          }

          if (expiration !== '12h' && expiration !== '7d' && expiration !== 'forever') {
            return apiJson({ error: 'Invalid expiration option' }, 400);
          }

          try {
            const parsed = new URL(originalUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return apiJson({ error: 'Only http and https URLs are supported' }, 400);
            }
          } catch {
            return apiJson({ error: 'Invalid URL format' }, 400);
          }

          const result = await createShareLink(env, originalUrl, expiration, now);
          const publicBase = getPublicBaseUrl(env, url);
          const shortUrl = `${publicBase}/${result.record.shortPath}`;

          return apiJson(
            {
              success: true,
              shortPath: result.record.shortPath,
              shortUrl,
              originalUrl: result.record.originalUrl,
              isExisting: result.isExisting,
              expiresAt: result.record.expiresAt,
            },
            result.isExisting ? 200 : 201
          );
        } catch (error) {
          console.error('Error creating share link', error);
          if (error instanceof Error && error.message === 'SHORT_PATH_GENERATION_FAILED') {
            return apiJson({ error: 'Failed to generate unique share link' }, 500);
          }
          return apiJson({ error: 'Failed to create share link' }, 500);
        }
      }

      if (request.method === 'POST' && pathname === '/api/urls') {
        try {
          const body = (await request.json()) as {
            url?: string;
            shortPath?: string;
            expiration?: ExpirationOption;
          };

          const originalUrl = body.url?.trim();
          const shortPath = body.shortPath?.trim();
          const expiration = body.expiration ?? 'forever';

          if (!originalUrl || !shortPath) {
            return apiJson({ error: 'Missing url or shortPath' }, 400);
          }

          if (shortPath.length !== 4) {
            return apiJson({ error: 'Short path must be exactly 4 characters' }, 400);
          }

          try {
            new URL(originalUrl);
          } catch {
            return apiJson({ error: 'Invalid URL format' }, 400);
          }

          const existing = await findExistingUrl(env, originalUrl, now);
          if (existing) {
            return apiJson({
              success: true,
              shortPath: existing.shortPath,
              originalUrl: existing.originalUrl,
              isExisting: true,
              expiresAt: existing.expiresAt,
            });
          }

          try {
            await ensureShortPathAvailable(env, shortPath, now);
          } catch (error) {
            if (error instanceof Error && error.message === 'SHORT_PATH_TAKEN') {
              return apiJson({ error: 'Short path already in use' }, 409);
            }
            throw error;
          }

          const expiresAt = getExpirationTime(expiration, now);

          await env.DB.prepare(
            'INSERT INTO urls (shortPath, originalUrl, createdAt, expiresAt) VALUES (?, ?, ?, ?)'
          )
            .bind(shortPath, originalUrl, now, expiresAt)
            .run();

          const record: UrlRecord = {
            shortPath,
            originalUrl,
            createdAt: now,
            expiresAt,
          };

          await putInCache(env, record, now);

          return apiJson({
            success: true,
            shortPath,
            originalUrl,
            isExisting: false,
            expiresAt,
          });
        } catch (error) {
          console.error('Error saving URL', error);
          return apiJson({ error: 'Failed to save URL' }, 500);
        }
      }

      if (request.method === 'GET' && pathname.startsWith('/api/urls/exists/')) {
        const shortPath = pathname.split('/').pop() ?? '';
        if (shortPath.length !== 4) {
          return apiJson({ exists: false });
        }

        const record = await getUrlRecord(env, shortPath, now);
        return apiJson({ exists: Boolean(record) });
      }

      if (request.method === 'GET' && pathname.startsWith('/api/urls/')) {
        const shortPath = pathname.split('/').pop() ?? '';
        if (shortPath.length !== 4) {
          return apiJson({ error: 'URL not found' }, 404);
        }

        const record = await getUrlRecord(env, shortPath, now);
        if (!record) {
          return apiJson({ error: 'URL not found' }, 404);
        }

        return apiJson(record);
      }

      return apiJson({ error: 'Not found' }, 404);
    }

    if (request.method === 'GET' && pathname !== '/' && pathname.length === 5) {
      const shortPath = pathname.slice(1);
      const record = await getUrlRecord(env, shortPath, now);
      if (!record) {
        return new Response('Link not found', {
          status: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      return Response.redirect(record.originalUrl, 302);
    }

    return new Response('OK', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};

export default handler;
