import Database from 'better-sqlite3';

export type ExpirationOption = '12h' | '7d' | 'forever';

interface UrlRecord {
  originalUrl: string;
  shortPath: string;
  createdAt: number;
  expiresAt: number | null;
}

export class UrlStorage {
  private db: Database.Database;

  constructor(purgeOnStart = false) {
    this.db = new Database('urls.db');
    this.initializeDatabase();
    
    // Optionally purge all URLs on startup
    if (purgeOnStart) {
      console.log('Purging all URLs on application startup');
      this.purgeAllUrls();
    }
    
    // Clean up expired URLs periodically
    this.cleanupExpiredUrls();
    setInterval(() => this.cleanupExpiredUrls(), 1000 * 60 * 5); // Every 5 minutes
    console.log('Database initialized successfully');
  }

  private initializeDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS urls (
        shortPath TEXT PRIMARY KEY,
        originalUrl TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_originalUrl ON urls (originalUrl);
    `);
  }

  private getExpirationTime(option: ExpirationOption): number | null {
    const now = Date.now();
    switch (option) {
      case '12h':
        return now + 12 * 60 * 60 * 1000;
      case '7d':
        return now + 7 * 24 * 60 * 60 * 1000;
      case 'forever':
        return null;
    }
  }

  findExistingUrl(originalUrl: string): string | null {
    try {
      console.log(`Looking up existing URL: ${originalUrl}`);
      const stmt = this.db.prepare(
        'SELECT shortPath FROM urls WHERE originalUrl = ? AND (expiresAt IS NULL OR expiresAt > ?) LIMIT 1'
      );
      
      const result = stmt.get(originalUrl, Date.now()) as { shortPath: string } | undefined;
      console.log(`Existing path lookup result: ${result ? result.shortPath : 'null'}`);
      return result ? result.shortPath : null;
    } catch (err) {
      console.error('Error finding existing URL:', err);
      return null;
    }
  }

  saveUrl(originalUrl: string, shortPath: string, expiration: ExpirationOption): string {
    try {
      // First check if URL already exists and is not expired
      const existingPath = this.findExistingUrl(originalUrl);
      if (existingPath) {
        console.log(`Using existing short path for ${originalUrl}: ${existingPath}`);
        return existingPath;
      }
      
      // Ensure shortPath is exactly 4 characters
      if (shortPath.length !== 4) {
        const error = `Invalid shortPath length: ${shortPath.length} (must be 4)`;
        console.error(error);
        throw new Error(error);
      }
      
      console.log(`Creating new short path for ${originalUrl}: ${shortPath}`);
      
      const stmt = this.db.prepare(
        'INSERT INTO urls (shortPath, originalUrl, createdAt, expiresAt) VALUES (?, ?, ?, ?)'
      );
      
      stmt.run(
        shortPath,
        originalUrl,
        Date.now(),
        this.getExpirationTime(expiration)
      );
      
      return shortPath;
    } catch (err) {
      console.error('Error saving URL:', err);
      throw err;
    }
  }

  getUrl(shortPath: string): UrlRecord | undefined {
    try {
      console.log(`Looking up URL for path: ${shortPath}`);
      
      const stmt = this.db.prepare(
        'SELECT * FROM urls WHERE shortPath = ?'
      );
      
      const url = stmt.get(shortPath) as UrlRecord | undefined;
      
      if (!url) {
        console.log(`No URL found for path: ${shortPath}`);
        return undefined;
      }
      
      // Check if URL has expired
      if (url.expiresAt && Date.now() > url.expiresAt) {
        console.log(`URL for path ${shortPath} has expired, deleting`);
        this.deleteUrl(shortPath);
        return undefined;
      }
      
      console.log(`Found URL for path ${shortPath}: ${url.originalUrl}`);
      return url;
    } catch (err) {
      console.error(`Error getting URL for path ${shortPath}:`, err);
      return undefined;
    }
  }

  urlExists(shortPath: string): boolean {
    const url = this.getUrl(shortPath);
    return !!url;
  }

  private deleteUrl(shortPath: string): void {
    try {
      const stmt = this.db.prepare('DELETE FROM urls WHERE shortPath = ?');
      stmt.run(shortPath);
    } catch (err) {
      console.error(`Error deleting URL for path ${shortPath}:`, err);
    }
  }

  private cleanupExpiredUrls(): void {
    try {
      const stmt = this.db.prepare(
        'DELETE FROM urls WHERE expiresAt IS NOT NULL AND expiresAt < ?'
      );
      const result = stmt.run(Date.now());
      if (result.changes > 0) {
        console.log(`Cleaned up ${result.changes} expired URLs`);
      }
    } catch (err) {
      console.error('Error cleaning up expired URLs:', err);
    }
  }

  purgeAllUrls(): void {
    try {
      const stmt = this.db.prepare('DELETE FROM urls');
      const result = stmt.run();
      console.log(`All URLs purged from database (${result.changes} records deleted)`);
    } catch (err) {
      console.error('Error purging URLs:', err);
    }
  }
}