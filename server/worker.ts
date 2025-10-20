import type { ExportedHandler } from '@cloudflare/workers-types';
import type { ExpirationOption, UrlRecord } from '../shared/urlTypes';

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

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
      ...JSON_HEADERS,
      ...(extraHeaders || {}),
    },
  });

const handleOptions = () =>
  new Response(null, {
    status: 204,
    headers: JSON_HEADERS,
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
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const now = Date.now();

    ctx.waitUntil(cleanupExpiredUrls(env, now));

    if (pathname.startsWith('/api/')) {
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
            return jsonResponse({ error: 'Missing url or shortPath' }, 400);
          }

          if (shortPath.length !== 4) {
            return jsonResponse({ error: 'Short path must be exactly 4 characters' }, 400);
          }

          try {
            new URL(originalUrl);
          } catch {
            return jsonResponse({ error: 'Invalid URL format' }, 400);
          }

          const existing = await findExistingUrl(env, originalUrl, now);
          if (existing) {
            return jsonResponse({
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
              return jsonResponse({ error: 'Short path already in use' }, 409);
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

          return jsonResponse({
            success: true,
            shortPath,
            originalUrl,
            isExisting: false,
            expiresAt,
          });
        } catch (error) {
          console.error('Error saving URL', error);
          return jsonResponse({ error: 'Failed to save URL' }, 500);
        }
      }

      if (request.method === 'GET' && pathname.startsWith('/api/urls/exists/')) {
        const shortPath = pathname.split('/').pop() ?? '';
        if (shortPath.length !== 4) {
          return jsonResponse({ exists: false });
        }

        const record = await getUrlRecord(env, shortPath, now);
        return jsonResponse({ exists: Boolean(record) });
      }

      if (request.method === 'GET' && pathname.startsWith('/api/urls/')) {
        const shortPath = pathname.split('/').pop() ?? '';
        if (shortPath.length !== 4) {
          return jsonResponse({ error: 'URL not found' }, 404);
        }

        const record = await getUrlRecord(env, shortPath, now);
        if (!record) {
          return jsonResponse({ error: 'URL not found' }, 404);
        }

        return jsonResponse(record);
      }

      return jsonResponse({ error: 'Not found' }, 404);
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
