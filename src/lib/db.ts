import type { ExpirationOption, UrlRecord } from '../../shared/urlTypes';

interface SaveUrlResponse {
  success: boolean;
  shortPath: string;
  originalUrl: string;
  isExisting: boolean;
  expiresAt: number | null;
}

const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

class UrlStorage {
  private readonly apiUrl: string;
  private readonly publicBase: string;

  constructor() {
    const configuredBase = import.meta.env.VITE_API_BASE_URL;
    const publicBaseEnv = import.meta.env.VITE_PUBLIC_BASE_URL;
    const fallbackBase = typeof window !== 'undefined' ? window.location.origin : '';

    const trimmedConfiguredBase = configuredBase ? trimTrailingSlash(configuredBase) : '';
    const trimmedPublicBase = publicBaseEnv ? trimTrailingSlash(publicBaseEnv) : '';

    const resolvedApiBase = trimmedConfiguredBase || trimmedPublicBase || fallbackBase;
    this.apiUrl = resolvedApiBase ? `${resolvedApiBase}/api` : '/api';

    const resolvedPublicBase = trimmedPublicBase || trimmedConfiguredBase || fallbackBase;
    this.publicBase = trimTrailingSlash(resolvedPublicBase);
  }

  async saveUrl(
    originalUrl: string,
    shortPath: string,
    expiration: ExpirationOption
  ): Promise<SaveUrlResponse> {
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

    const data = (await response.json()) as SaveUrlResponse;
    return data;
  }

  getShortUrl(shortPath: string): string {
    const base = this.publicBase || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${trimTrailingSlash(base)}/${shortPath}`;
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
}

export const urlStorage = new UrlStorage();
export type { ExpirationOption, UrlRecord } from '../../shared/urlTypes';
