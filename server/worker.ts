import type { ExportedHandler } from '@cloudflare/workers-types';
import type { ExpirationOption, UrlRecord } from '../shared/urlTypes';

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ALLOWED_ORIGINS?: string;
  PUBLIC_BASE_URL?: string;
}

const ACCESS_CONTROL_ALLOW_HEADERS = 'Content-Type';
const ACCESS_CONTROL_ALLOW_METHODS = 'GET,POST,OPTIONS';

const buildCorsHeaders = (origin: string | null): Record<string, string> => {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ACCESS_CONTROL_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': ACCESS_CONTROL_ALLOW_METHODS,
    Vary: 'Origin',
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
};

const parseAllowedOrigins = (value: string | undefined, fallbackOrigins: string[]): string[] => {
  if (!value) {
    return fallbackOrigins;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const resolveCors = (request: Request, env: Env): { allowed: boolean; headers: Record<string, string> } => {
  const requestOrigin = request.headers.get('Origin');
  const url = new URL(request.url);

  const fallbackOrigins = new Set<string>([`${url.protocol}//${url.host}`]);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    fallbackOrigins.add('http://localhost:5173');
    fallbackOrigins.add('http://127.0.0.1:5173');
  }

  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS, Array.from(fallbackOrigins));

  if (allowedOrigins.includes('*')) {
    return { allowed: true, headers: buildCorsHeaders('*') };
  }

  if (!requestOrigin) {
    const [defaultOrigin] = allowedOrigins;
    return { allowed: true, headers: buildCorsHeaders(defaultOrigin ?? null) };
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return { allowed: true, headers: buildCorsHeaders(requestOrigin) };
  }

  return { allowed: false, headers: buildCorsHeaders(null) };
};

const SHORT_PATH_LENGTH = 4;
const SHORT_PATH_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const generateRandomShortPath = (length = SHORT_PATH_LENGTH): string => {
  const charsLength = SHORT_PATH_CHARSET.length;
  const randomValues = new Uint32Array(length);
  globalThis.crypto.getRandomValues(randomValues);

  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += SHORT_PATH_CHARSET[randomValues[i] % charsLength];
  }

  return output;
};

const isExpirationOption = (value: unknown): value is ExpirationOption =>
  value === '12h' || value === '7d' || value === 'forever';

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

const jsonResponse = (body: unknown, status = 200, extraHeaders?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
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
    const cors = resolveCors(request, env);

    if (request.method === 'OPTIONS') {
      if (!cors.allowed) {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors.headers);
      }
      return handleOptions(cors.headers);
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const now = Date.now();

    ctx.waitUntil(cleanupExpiredUrls(env, now));

    if (pathname.startsWith('/api/')) {
      if (!cors.allowed) {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors.headers);
      }

      const apiJson = (body: unknown, status = 200) => jsonResponse(body, status, cors.headers);

      if (request.method === 'POST' && pathname === '/api/share-links') {
        try {
          const body = (await request.json()) as {
            url?: unknown;
            expiration?: unknown;
          };

          const originalUrlInput = typeof body.url === 'string' ? body.url.trim() : '';
          if (!originalUrlInput) {
            return apiJson({ error: 'Missing url' }, 400);
          }

          let normalizedUrl: string;
          try {
            const parsed = new URL(originalUrlInput);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return apiJson({ error: 'Only http and https URLs are supported' }, 400);
            }
            normalizedUrl = parsed.toString();
          } catch {
            return apiJson({ error: 'Invalid URL format' }, 400);
          }

          const requestedExpirationRaw = body.expiration;
          const requestedExpiration = isExpirationOption(requestedExpirationRaw) ? requestedExpirationRaw : '7d';

          if (requestedExpiration === 'forever') {
            return apiJson({ error: 'Share links must include an expiration time' }, 400);
          }

          const expiresAt = getExpirationTime(requestedExpiration, now);
          if (!expiresAt) {
            return apiJson({ error: 'Failed to calculate expiration' }, 500);
          }

          const maxAttempts = 6;
          let shareRecord: UrlRecord | null = null;
          let lastError: unknown;

          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const candidate = generateRandomShortPath();

            try {
              await ensureShortPathAvailable(env, candidate, now);
            } catch (error) {
              if (error instanceof Error && error.message === 'SHORT_PATH_TAKEN') {
                lastError = error;
                continue;
              }
              throw error;
            }

            const record: UrlRecord = {
              originalUrl: normalizedUrl,
              shortPath: candidate,
              createdAt: now,
              expiresAt,
            };

            try {
              await env.DB.prepare(
                'INSERT INTO urls (shortPath, originalUrl, createdAt, expiresAt) VALUES (?, ?, ?, ?)'
              )
                .bind(record.shortPath, record.originalUrl, record.createdAt, record.expiresAt)
                .run();

              await putInCache(env, record, now);
              shareRecord = record;
              break;
            } catch (error) {
              lastError = error;
              if (error instanceof Error && /constraint failed|UNIQUE/i.test(error.message)) {
                continue;
              }
              throw error;
            }
          }

          if (!shareRecord) {
            console.error('Failed to generate share link', lastError);
            return apiJson({ error: 'Failed to generate share link' }, 500);
          }

          const baseUrl = (env.PUBLIC_BASE_URL ?? `${url.protocol}//${url.host}`).replace(/\/+$/, '');
          const shareUrl = `${baseUrl}/${shareRecord.shortPath}`;

          return apiJson(
            {
              success: true,
              shortPath: shareRecord.shortPath,
              shareUrl,
              originalUrl: shareRecord.originalUrl,
              expiresAt: shareRecord.expiresAt,
            },
            201
          );
        } catch (error) {
          console.error('Error generating share link', error);
          return apiJson({ error: 'Failed to generate share link' }, 500);
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

          if (shortPath.length !== SHORT_PATH_LENGTH) {
            return apiJson({ error: `Short path must be exactly ${SHORT_PATH_LENGTH} characters` }, 400);
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
        if (shortPath.length !== SHORT_PATH_LENGTH) {
          return apiJson({ exists: false });
        }

        const record = await getUrlRecord(env, shortPath, now);
        return apiJson({ exists: Boolean(record) });
      }

      if (request.method === 'GET' && pathname.startsWith('/api/urls/')) {
        const shortPath = pathname.split('/').pop() ?? '';
        if (shortPath.length !== SHORT_PATH_LENGTH) {
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

    if (request.method === 'GET' && pathname !== '/' && pathname.length === SHORT_PATH_LENGTH + 1) {
      const shortPath = pathname.slice(1);
      const record = await getUrlRecord(env, shortPath, now);
      if (!record) {
        return new Response('Link not found', {
          status: 404,
          headers: {
            ...cors.headers,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      const redirectResponse = Response.redirect(record.originalUrl, 302);
      const allowedOrigin = (cors.headers as Record<string, string>)['Access-Control-Allow-Origin'];
      if (allowedOrigin) {
        redirectResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
      }
      redirectResponse.headers.set('Vary', 'Origin');
      redirectResponse.headers.set('Access-Control-Allow-Headers', ACCESS_CONTROL_ALLOW_HEADERS);
      redirectResponse.headers.set('Access-Control-Allow-Methods', ACCESS_CONTROL_ALLOW_METHODS);
      return redirectResponse;
    }

    return new Response('OK', {
      status: 200,
      headers: {
        ...cors.headers,
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  },
};

export default handler;
