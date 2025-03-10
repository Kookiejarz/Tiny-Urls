const API_URL = 'http://localhost:3000';

export interface UrlRecord {
  id: number;
  original_url: string;
  short_path: string;
  created_at: string;
  expires_at: string | null;
}

export async function shortenUrl(originalUrl: string, shortPath: string, expiration: string): Promise<UrlRecord> {
  const response = await fetch(`${API_URL}/api/urls/shorten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalUrl, shortPath, expiration })
  });

  if (!response.ok) throw new Error('Failed to shorten URL');
  return response.json();
}

export async function getUrl(shortPath: string): Promise<UrlRecord | null> {
  const response = await fetch(`${API_URL}/api/urls/${shortPath}`);
  if (!response.ok) return null;
  return response.json();
}