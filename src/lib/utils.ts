export function ensureHttps(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(ensureHttps(url));
    return urlObj.toString().toLowerCase().replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

export function generateShortPath(): string {
  // Use timestamp as base number
  const timestamp = Date.now();
  const characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const base = characters.length; // base62
  let shortPath = '';
  
  // Convert timestamp to base62
  let num = timestamp;
  while (num > 0) {
    shortPath = characters[num % base] + shortPath;
    num = Math.floor(num / base);
  }
  
  // Ensure minimum length of 4 characters
  while (shortPath.length < 4) {
    shortPath = characters[Math.floor(Math.random() * base)] + shortPath;
  }
  
  // Take last 4 characters to keep it short
  return shortPath.slice(-4);
}