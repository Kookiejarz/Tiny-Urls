import type { ExportedHandler } from '@cloudflare/workers-types';
import type { ExpirationOption, UrlRecord } from '../shared/urlTypes';

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ALLOWED_ORIGINS?: string;
  PERMANENT_ALLOWED_ORIGINS?: string;
  PUBLIC_BASE_URL?: string;
  GITHUB_TOKEN?: string;
}

// Removed CLI_USER_AGENTS, isCliRequest, hashString, recordVisit and related logic for visit count.

const JSON_CONTENT_HEADERS = {
  'Content-Type': 'application/json',
} as const;

const CORS_BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  Vary: 'Origin',
} as const;

const SHORT_PATH_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_SHORT_PATH_ATTEMPTS = 10;
const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;
const MAX_CUSTOM_EXPIRATION_MS = 180 * DAY_IN_MS;

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "twclid",
  "mc_eid", "mc_cid", "_ga", "_gl", "ref", "source",
]);

const cacheKeyForShortPath = (shortPath: string) => `short:${shortPath}`;

const isValidExpirationOption = (value: unknown): value is ExpirationOption =>
  value === '12h' || value === '7d' || value === '180d' || value === 'permanent';

const getExpirationTime = (option: ExpirationOption, now: number): number | null => {
  switch (option) {
    case '12h':
      return now + 12 * HOUR_IN_MS;
    case '7d':
      return now + 7 * DAY_IN_MS;
    case '180d':
      return now + 180 * DAY_IN_MS;
    case 'permanent':
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

  const permanent = env.PERMANENT_ALLOWED_ORIGINS
    ? env.PERMANENT_ALLOWED_ORIGINS.split(',')
        .map((origin) => normalizeOrigin(origin.trim()))
        .filter(Boolean)
    : [];

  const combined = [...new Set([...configured, ...permanent])];

  if (combined.length === 0) {
    return [normalizeOrigin(fallbackOrigin)];
  }

  return combined;
};

const resolveAllowedOrigin = (request: Request, env: Env, fallbackOrigin: string): string | null => {
  const allowedOrigins = parseAllowedOrigins(env, fallbackOrigin);
  const requestOrigin = request.headers.get('Origin');

  if (allowedOrigins.includes('*')) {
    return '*';
  }

  if (requestOrigin) {
    if (requestOrigin === 'null') {
      return null;
    }
    const normalizedOrigin = normalizeOrigin(requestOrigin);

    if (allowedOrigins.includes(normalizedOrigin)) {
      return normalizedOrigin;
    }

    // If no ALLOWED_ORIGINS and no PERMANENT_ALLOWED_ORIGINS are set, 
    // allow requests from the same apex domain as fallbackOrigin (the worker domain)
    if (!env.ALLOWED_ORIGINS && !env.PERMANENT_ALLOWED_ORIGINS) {
      try {
        const requestUrl = new URL(requestOrigin);
        const workerUrl = new URL(fallbackOrigin);
        
        // Allow localhost for development
        if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') {
          return normalizedOrigin;
        }

        // Allow same apex domain (e.g., liuu.org and short.liuu.org)
        const getApex = (host: string) => host.split('.').slice(-2).join('.');
        if (getApex(requestUrl.hostname) === getApex(workerUrl.hostname)) {
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

const isPermanentAllowed = (request: Request, env: Env): boolean => {
  const requestOrigin = request.headers.get('Origin');
  if (!requestOrigin) return false;

  const normalizedOrigin = normalizeOrigin(requestOrigin);
  const permanentOrigins = env.PERMANENT_ALLOWED_ORIGINS
    ? env.PERMANENT_ALLOWED_ORIGINS.split(',')
        .map((origin) => normalizeOrigin(origin.trim()))
        .filter(Boolean)
    : [];

  return permanentOrigins.includes(normalizedOrigin);
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
  expiresAt: number | null,
  now: number
) => {
  const existing = await findExistingUrl(env, originalUrl, now);
  if (existing) {
    return { record: existing, isExisting: true as const };
  }

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
            expiresAt?: number;
          };

          const originalUrl = body.url?.trim();

          if (!originalUrl) {
            return apiJson({ error: 'Missing url' }, 400);
          }

          let expiresAt: number | null;
          if (body.expiresAt !== undefined) {
            if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) {
              return apiJson({ error: 'Invalid expiresAt value' }, 400);
            }

            expiresAt = Math.floor(body.expiresAt);
            if (expiresAt <= now) {
              return apiJson({ error: 'expiresAt must be in the future' }, 400);
            }
          } else {
            const expiration = body.expiration ?? '7d';
            if (!isValidExpirationOption(expiration)) {
              return apiJson({ error: 'Invalid expiration option' }, 400);
            }
            expiresAt = getExpirationTime(expiration, now);
          }

          if (expiresAt === null || expiresAt > now + MAX_CUSTOM_EXPIRATION_MS) {
            if (!isPermanentAllowed(request, env)) {
              return apiJson({ error: 'Expiration cannot exceed 180 days from now' }, 400);
            }
          }

          try {
            const parsed = new URL(originalUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return apiJson({ error: 'Only http and https URLs are supported' }, 400);
            }
          } catch {
            return apiJson({ error: 'Invalid URL format' }, 400);
          }

          const result = await createShareLink(env, originalUrl, expiresAt, now);
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
            expiresAt?: number;
          };

          const originalUrl = body.url?.trim();
          const shortPath = body.shortPath?.trim();

          if (!originalUrl || !shortPath) {
            return apiJson({ error: 'Missing url or shortPath' }, 400);
          }

          if (shortPath.length < 4 || shortPath.length > 8) {
            return apiJson({ error: "Short path must be between 4 and 8 characters" }, 400);
          }   

          if (!/^[A-Za-z0-9]+$/.test(shortPath)) {
            return apiJson({ error: "Short path must contain only letters and digits" }, 400);
          }

          try {
            new URL(originalUrl);
          } catch {
            return apiJson({ error: 'Invalid URL format' }, 400);
          }

          let expiresAt: number | null;
          if (body.expiresAt !== undefined) {
            if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) {
              return apiJson({ error: 'Invalid expiresAt value' }, 400);
            }
            const normalizedExpiresAt = Math.floor(body.expiresAt);
            if (normalizedExpiresAt <= now) {
              return apiJson({ error: 'expiresAt must be in the future' }, 400);
            }
            expiresAt = normalizedExpiresAt;
          } else {
            const expiration = body.expiration ?? '180d';
            if (!isValidExpirationOption(expiration)) {
              return apiJson({ error: 'Invalid expiration option' }, 400);
            }
            expiresAt = getExpirationTime(expiration, now);
          }

          if (expiresAt === null || expiresAt > now + MAX_CUSTOM_EXPIRATION_MS) {
            if (!isPermanentAllowed(request, env)) {
              return apiJson({ error: 'Expiration cannot exceed 180 days from now' }, 400);
            }
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

    const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';
    // Match /r/shortPath or legacy direct path
    const redirectMatch = pathname.match(/^\/(r\/)?([A-Za-z0-9]{4,10})$/);

    if (isGetOrHead && pathname !== '/' && !pathname.startsWith('/api/') && redirectMatch) {
      const shortPath = redirectMatch[2];
      const record = await getUrlRecord(env, shortPath, now);
      
      if (record) {
        const isGitHubRaw = record.originalUrl.includes('raw.githubusercontent.com');

        if (isGitHubRaw) {
          try {
            const fetchOptions: RequestInit = {
              method: request.method,
              headers: env.GITHUB_TOKEN ? { 'Authorization': `token ${env.GITHUB_TOKEN}` } : {},
              redirect: 'follow'
            };
            
            const githubResponse = await fetch(record.originalUrl, fetchOptions);
            
            if (githubResponse.ok) {
              const newHeaders = new Headers(githubResponse.headers);
              const fileName = record.originalUrl.split('/').pop() || 'file';
              
              // Force download/stream
              newHeaders.set('Content-Disposition', `attachment; filename="${fileName}"`);
              newHeaders.set('Access-Control-Allow-Origin', '*');
              newHeaders.set('X-Content-Type-Options', 'nosniff');
              
              const contentType = githubResponse.headers.get('Content-Type');
              if (contentType) {
                newHeaders.set('Content-Type', contentType);
              }
              
              return new Response(request.method === 'HEAD' ? null : githubResponse.body, {
                status: githubResponse.status,
                headers: newHeaders,
              });
            }
          } catch (error) {
            console.error('GitHub proxy error:', error);
          }
        }

        return Response.redirect(record.originalUrl, 302);
      }
    }

    return new Response('OK', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain; charset=utf-8'
      },
    });
  },
};

export default handler;
