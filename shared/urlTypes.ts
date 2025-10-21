export type ExpirationOption = '12h' | '7d' | '180d';

export interface UrlRecord {
  originalUrl: string;
  shortPath: string;
  createdAt: number;
  expiresAt: number | null;
}
