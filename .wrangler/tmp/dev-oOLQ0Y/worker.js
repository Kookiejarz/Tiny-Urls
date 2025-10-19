var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-1Szu1t/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-1Szu1t/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// server/worker.ts
var JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};
var cacheKeyForShortPath = /* @__PURE__ */ __name((shortPath) => `short:${shortPath}`, "cacheKeyForShortPath");
var getExpirationTime = /* @__PURE__ */ __name((option, now) => {
  switch (option) {
    case "12h":
      return now + 12 * 60 * 60 * 1e3;
    case "7d":
      return now + 7 * 24 * 60 * 60 * 1e3;
    case "forever":
      return null;
  }
}, "getExpirationTime");
var jsonResponse = /* @__PURE__ */ __name((body, status = 200, extraHeaders) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...JSON_HEADERS,
    ...extraHeaders || {}
  }
}), "jsonResponse");
var handleOptions = /* @__PURE__ */ __name(() => new Response(null, {
  status: 204,
  headers: JSON_HEADERS
}), "handleOptions");
var putInCache = /* @__PURE__ */ __name(async (env, record, now) => {
  const ttl = record.expiresAt ? Math.max(Math.floor((record.expiresAt - now) / 1e3), 1) : void 0;
  const options = ttl ? { expirationTtl: ttl } : void 0;
  await env.CACHE.put(cacheKeyForShortPath(record.shortPath), JSON.stringify(record), options);
}, "putInCache");
var deleteFromCache = /* @__PURE__ */ __name((env, shortPath) => env.CACHE.delete(cacheKeyForShortPath(shortPath)), "deleteFromCache");
var getCachedUrl = /* @__PURE__ */ __name(async (env, shortPath) => {
  const cached = await env.CACHE.get(cacheKeyForShortPath(shortPath), "json");
  return cached ?? null;
}, "getCachedUrl");
var fetchUrlFromDatabase = /* @__PURE__ */ __name(async (env, shortPath) => {
  const result = await env.DB.prepare(
    "SELECT shortPath, originalUrl, createdAt, expiresAt FROM urls WHERE shortPath = ? LIMIT 1"
  ).bind(shortPath).first();
  return result ?? null;
}, "fetchUrlFromDatabase");
var removeUrl = /* @__PURE__ */ __name(async (env, shortPath) => {
  await env.DB.prepare("DELETE FROM urls WHERE shortPath = ?").bind(shortPath).run();
  await deleteFromCache(env, shortPath);
}, "removeUrl");
var cleanupExpiredUrls = /* @__PURE__ */ __name(async (env, now) => {
  await env.DB.prepare("DELETE FROM urls WHERE expiresAt IS NOT NULL AND expiresAt <= ?").bind(now).run();
}, "cleanupExpiredUrls");
var ensureShortPathAvailable = /* @__PURE__ */ __name(async (env, shortPath, now) => {
  const existing = await fetchUrlFromDatabase(env, shortPath);
  if (!existing) {
    return;
  }
  if (existing.expiresAt && now > existing.expiresAt) {
    await removeUrl(env, shortPath);
    return;
  }
  throw new Error("SHORT_PATH_TAKEN");
}, "ensureShortPathAvailable");
var findExistingUrl = /* @__PURE__ */ __name(async (env, originalUrl, now) => {
  const existing = await env.DB.prepare(
    "SELECT shortPath, originalUrl, createdAt, expiresAt FROM urls WHERE originalUrl = ? AND (expiresAt IS NULL OR expiresAt > ?) LIMIT 1"
  ).bind(originalUrl, now).first();
  if (!existing) {
    return null;
  }
  await putInCache(env, existing, now);
  return existing;
}, "findExistingUrl");
var getUrlRecord = /* @__PURE__ */ __name(async (env, shortPath, now) => {
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
}, "getUrlRecord");
var handler = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const now = Date.now();
    ctx.waitUntil(cleanupExpiredUrls(env, now));
    if (pathname.startsWith("/api/")) {
      if (request.method === "POST" && pathname === "/api/urls") {
        try {
          const body = await request.json();
          const originalUrl = body.url?.trim();
          const shortPath = body.shortPath?.trim();
          const expiration = body.expiration ?? "forever";
          if (!originalUrl || !shortPath) {
            return jsonResponse({ error: "Missing url or shortPath" }, 400);
          }
          if (shortPath.length !== 4) {
            return jsonResponse({ error: "Short path must be exactly 4 characters" }, 400);
          }
          try {
            new URL(originalUrl);
          } catch {
            return jsonResponse({ error: "Invalid URL format" }, 400);
          }
          const existing = await findExistingUrl(env, originalUrl, now);
          if (existing) {
            return jsonResponse({
              success: true,
              shortPath: existing.shortPath,
              originalUrl: existing.originalUrl,
              isExisting: true,
              expiresAt: existing.expiresAt
            });
          }
          try {
            await ensureShortPathAvailable(env, shortPath, now);
          } catch (error) {
            if (error instanceof Error && error.message === "SHORT_PATH_TAKEN") {
              return jsonResponse({ error: "Short path already in use" }, 409);
            }
            throw error;
          }
          const expiresAt = getExpirationTime(expiration, now);
          await env.DB.prepare(
            "INSERT INTO urls (shortPath, originalUrl, createdAt, expiresAt) VALUES (?, ?, ?, ?)"
          ).bind(shortPath, originalUrl, now, expiresAt).run();
          const record = {
            shortPath,
            originalUrl,
            createdAt: now,
            expiresAt
          };
          await putInCache(env, record, now);
          return jsonResponse({
            success: true,
            shortPath,
            originalUrl,
            isExisting: false,
            expiresAt
          });
        } catch (error) {
          console.error("Error saving URL", error);
          return jsonResponse({ error: "Failed to save URL" }, 500);
        }
      }
      if (request.method === "GET" && pathname.startsWith("/api/urls/exists/")) {
        const shortPath = pathname.split("/").pop() ?? "";
        if (shortPath.length !== 4) {
          return jsonResponse({ exists: false });
        }
        const record = await getUrlRecord(env, shortPath, now);
        return jsonResponse({ exists: Boolean(record) });
      }
      if (request.method === "GET" && pathname.startsWith("/api/urls/")) {
        const shortPath = pathname.split("/").pop() ?? "";
        if (shortPath.length !== 4) {
          return jsonResponse({ error: "URL not found" }, 404);
        }
        const record = await getUrlRecord(env, shortPath, now);
        if (!record) {
          return jsonResponse({ error: "URL not found" }, 404);
        }
        return jsonResponse(record);
      }
      return jsonResponse({ error: "Not found" }, 404);
    }
    if (request.method === "GET" && pathname !== "/" && pathname.length === 5) {
      const shortPath = pathname.slice(1);
      const record = await getUrlRecord(env, shortPath, now);
      if (!record) {
        return new Response("Link not found", {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      return Response.redirect(record.originalUrl, 302);
    }
    return new Response("OK", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
var worker_default = handler;

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-1Szu1t/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-1Szu1t/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
