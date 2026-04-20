function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const s = part.trim();
    if (s.startsWith(prefix)) return decodeURIComponent(s.slice(prefix.length));
  }
  return null;
}

export function csrfHeaders(): Record<string, string> {
  const token = readCookie('csrf_token');
  return token ? { 'x-csrf-token': token } : {};
}

