export function getExpirationTime(option: string): string | null {
  const now = new Date();
  
  switch (option) {
    case '12h':
      return new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'forever':
      return null;
    default:
      return null;
  }
}