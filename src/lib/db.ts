import { openDB, DBSchema, IDBPDatabase } from 'idb';

export type ExpirationOption = '12h' | '7d' | 'forever';

export interface UrlRecord {
  originalUrl: string;
  shortPath: string;
  createdAt: number;
  expiresAt: number | null;
}

interface UrlDB extends DBSchema {
  urls: {
    key: string;
    value: UrlRecord;
  };
}

export class UrlStorage {
  private db: Promise<IDBPDatabase<UrlDB>>;

  constructor() {
    this.db = openDB<UrlDB>('url-shortener', 1, {
      upgrade(db) {
        db.createObjectStore('urls', { keyPath: 'shortPath' });
      },
    });

    // Clean up expired URLs periodically
    this.cleanupExpiredUrls();
    setInterval(() => this.cleanupExpiredUrls(), 1000 * 60 * 5); // Every 5 minutes
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

  async saveUrl(originalUrl: string, shortPath: string, expiration: ExpirationOption) {
    const db = await this.db;
    return db.put('urls', {
      originalUrl,
      shortPath,
      createdAt: Date.now(),
      expiresAt: this.getExpirationTime(expiration),
    });
  }

  async getUrl(shortPath: string): Promise<UrlRecord | undefined> {
    const db = await this.db;
    const url = await db.get('urls', shortPath);
    
    if (!url) return undefined;
    
    // Check if URL has expired
    if (url.expiresAt && Date.now() > url.expiresAt) {
      await this.deleteUrl(shortPath);
      return undefined;
    }
    
    return url;
  }

  async urlExists(shortPath: string): Promise<boolean> {
    const url = await this.getUrl(shortPath);
    return !!url;
  }

  private async deleteUrl(shortPath: string) {
    const db = await this.db;
    await db.delete('urls', shortPath);
  }

  private async cleanupExpiredUrls() {
    const db = await this.db;
    const tx = db.transaction('urls', 'readwrite');
    const store = tx.objectStore('urls');
    const now = Date.now();

    let cursor = await store.openCursor();
    while (cursor) {
      const url = cursor.value;
      if (url.expiresAt && now > url.expiresAt) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
  }

  async purgeAllUrls() {
    const db = await this.db;
    await db.clear('urls');
  }

  async getDb(): Promise<IDBPDatabase<UrlDB>> {
    return this.db;
  }
}

export const urlStorage = new UrlStorage();