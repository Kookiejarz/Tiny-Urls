CREATE TABLE IF NOT EXISTS urls (
  shortPath TEXT PRIMARY KEY,
  originalUrl TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_urls_originalUrl ON urls (originalUrl);
CREATE INDEX IF NOT EXISTS idx_urls_expiresAt ON urls (expiresAt);
