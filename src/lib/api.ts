const API_URL = import.meta.env.PROD 
  ? 'https://url-shortener.cookie2275.workers.dev/'
  : 'http://localhost:8787';

export async function shortenUrl(originalUrl: string, shortPath: string, expiration: string): Promise<UrlRecord> {
  const response = await fetch(`${API_URL}/api/urls/shorten`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ originalUrl, shortPath, expiration })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to shorten URL' }));
    throw new Error(error.message || 'Failed to shorten URL');
  }
  
  return response.json();
}

export interface UrlRecord {
  id: number;
  original_url: string;
  short_path: string;
  created_at: string;
  expires_at: string | null;
}

export async function getUrl(shortPath: string): Promise<UrlRecord | null> {
  const response = await fetch(`${API_URL}/api/urls/${shortPath}`);
  if (!response.ok) return null;
  return response.json();
}