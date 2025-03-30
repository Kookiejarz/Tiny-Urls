import type { ExpirationOption } from '../../server/db';

interface UrlRecord {
  originalUrl: string;
  shortPath: string;
  createdAt: number;
  expiresAt: number | null;
}

class UrlStorage {
  private apiUrl = 'http://localhost:3000/api';

  async saveUrl(originalUrl: string, shortPath: string, expiration: ExpirationOption) {
    const response = await fetch(`${this.apiUrl}/urls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: originalUrl,
        shortPath,
        expiration,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save URL');
    }

    const data = await response.json();
    return data; // Return the full response data which includes shortPath
  }

  async getUrl(shortPath: string): Promise<UrlRecord | undefined> {
    const response = await fetch(`${this.apiUrl}/urls/${shortPath}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return undefined;
      }
      throw new Error('Failed to retrieve URL');
    }
    
    return response.json();
  }

  async urlExists(shortPath: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/urls/exists/${shortPath}`);
    
    if (!response.ok) {
      throw new Error('Failed to check URL');
    }
    
    const data = await response.json();
    return data.exists;
  }

  async purgeAllUrls() {
    // This method is no longer needed in the frontend
  }
}

export const urlStorage = new UrlStorage();