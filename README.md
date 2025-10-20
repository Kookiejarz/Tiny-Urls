
## Share Link API

This document explains how to create short share links through the `/api/share` endpoint exposed by the worker in `server/worker.ts`.

### Endpoint

- **URL:** `POST /api/share`
- **Description:** Generates (or reuses) a short link that redirects to an external site.
- **Content Type:** `application/json`

### Request Body

```json
{
  "url": "https://example.com/article",
  "expiration": "7d"
}
```

- `url` (string, required): Absolute destination URL. Only `http` and `https` are accepted.
- `expiration` (string, optional): How long the short link should stay active. Valid values:
  - `12h` (12 hours)
  - `7d` (7 days) — default
  - `forever` (no automatic expiry)

### Successful Response

Status code `201` for a new short link, `200` if an existing, non-expired link for the same URL is reused.

```json
{
  "success": true,
  "shortPath": "abcd",
  "shortUrl": "https://short.example.com/abcd",
  "originalUrl": "https://example.com/article",
  "isExisting": false,
  "expiresAt": 1726000000000
}
```

- `shortPath` (string): The generated 4-character slug.
- `shortUrl` (string): Fully qualified short URL (uses `PUBLIC_BASE_URL` or request origin).
- `originalUrl` (string): The URL supplied in the request.
- `isExisting` (boolean): `true` when an existing, non-expired short link for the same destination was returned instead of creating a new one.
- `expiresAt` (number|null): Unix timestamp in milliseconds for automatic expiry. `null` when `expiration` was `forever`.

### Error Responses

- `400` — Invalid payload (missing `url`, unsupported scheme, or bad `expiration` value).
- `403` — Request origin not in the allowed CORS list.
- `500` — Internal failure or inability to generate a unique short path.

Each error response has the shape:

```json
{ "error": "message" }
```

### Curl Example

```bash
curl -X POST https://short.example.com/api/share \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article","expiration":"12h"}'
```

### CORS Configuration

The worker only serves API responses to approved origins.

| Environment Variable | Purpose | Example |
|----------------------|---------|---------|
| `ALLOWED_ORIGINS` | Comma-separated list of origins allowed to call the API. If omitted, requests from the same origin (and local development hosts) are accepted. | `https://short.example.com,https://app.example.com` |
| `PUBLIC_BASE_URL` | Optional base URL used to build `shortUrl` in responses. Defaults to the request origin when not provided. | `https://short.example.com` |

Set these variables with `wrangler secret put` or in your deployment dashboard.

### Notes

- The worker automatically purges expired records and caches active ones in Cloudflare KV for fast lookups.
- Rate limiting or authentication is not provided; add them upstream if required.
