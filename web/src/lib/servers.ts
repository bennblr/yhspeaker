export interface KnownServer {
  url: string;
  name: string;
  lastUsed: number;
  current: boolean;
}

const STORAGE_KEY = 'la2speak.servers';
const COOKIE_KEY = 'la2speak_servers';
const MAX_SERVERS = 15;
const MAX_NAME = 60;

interface StoredServer {
  url: string;
  name: string;
  lastUsed: number;
}

export function normalizeServerUrl(value: string): string | null {
  const raw = value.trim().replace(/\s+/g, '');
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function serverHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

export function currentServerUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function sanitize(list: unknown): StoredServer[] {
  if (!Array.isArray(list)) return [];
  const result: StoredServer[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<StoredServer>;
    const url = typeof entry.url === 'string' ? normalizeServerUrl(entry.url) : null;
    if (!url || result.some((existing) => existing.url === url)) continue;
    result.push({
      url,
      name: typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME) : '',
      lastUsed: Number.isFinite(entry.lastUsed) ? Number(entry.lastUsed) : 0,
    });
  }
  return result.slice(0, MAX_SERVERS);
}

function readStorage(): StoredServer[] {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function cookieDomain(): string | null {
  const host = window.location.hostname;
  if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const labels = host.split('.');
  return labels.length > 2 ? `.${labels.slice(-2).join('.')}` : null;
}

function readCookie(): StoredServer[] {
  try {
    const match = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${COOKIE_KEY}=`));
    if (!match) return [];
    const value = decodeURIComponent(match.slice(COOKIE_KEY.length + 1));
    return sanitize(JSON.parse(value));
  } catch {
    return [];
  }
}

function merge(...lists: StoredServer[][]): StoredServer[] {
  const byUrl = new Map<string, StoredServer>();
  for (const list of lists) {
    for (const entry of list) {
      const existing = byUrl.get(entry.url);
      if (!existing) {
        byUrl.set(entry.url, { ...entry });
        continue;
      }
      existing.lastUsed = Math.max(existing.lastUsed, entry.lastUsed);
      if (entry.name) existing.name = entry.name;
    }
  }
  return [...byUrl.values()].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_SERVERS);
}

function write(all: StoredServer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage disabled */
  }
  const domain = cookieDomain();
  const value = encodeURIComponent(JSON.stringify(all));
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_KEY}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}${
    domain ? `; Domain=${domain}` : ''
  }`;
}

export function listKnownServers(): KnownServer[] {
  const current = currentServerUrl();
  return merge(readStorage(), readCookie()).map((entry) => ({
    ...entry,
    current: entry.url === current,
  }));
}

export function rememberServer(value: string, name?: string): void {
  const url = normalizeServerUrl(value);
  if (!url) return;
  const all = merge(readStorage(), readCookie());
  const existing = all.find((entry) => entry.url === url);
  const cleanName = name?.trim().slice(0, MAX_NAME) ?? '';
  if (existing) {
    existing.lastUsed = Date.now();
    if (cleanName) existing.name = cleanName;
  } else {
    all.unshift({ url, name: cleanName, lastUsed: Date.now() });
  }
  write(all.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_SERVERS));
}

export function forgetServer(value: string): void {
  const url = normalizeServerUrl(value);
  if (!url) return;
  write(merge(readStorage(), readCookie()).filter((entry) => entry.url !== url));
}
