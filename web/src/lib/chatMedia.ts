const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

const TRAILING_PUNCTUATION = '.,!?;:…»"*_~';

export type ChatToken = { type: 'text'; text: string } | { type: 'url'; text: string; href: string };

function trimUrlSuffix(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (!last) break;
    if (TRAILING_PUNCTUATION.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.match(/\)/g) ?? []).length;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

function toHref(raw: string): string | null {
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function splitChatText(text: string): ChatToken[] {
  const tokens: ChatToken[] = [];
  let index = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const raw = trimUrlSuffix(match[0]);
    // Ссылка может состоять только из обрезанных символов — тогда это обычный текст.
    if (!raw) continue;
    const href = toHref(raw);
    if (!href) continue;
    if (start > index) tokens.push({ type: 'text', text: text.slice(index, start) });
    tokens.push({ type: 'url', text: raw, href });
    index = start + raw.length;
  }
  if (index < text.length) tokens.push({ type: 'text', text: text.slice(index) });
  return tokens;
}

export function isImageUrl(href: string): boolean {
  try {
    return IMAGE_EXTENSION.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

export function youtubeVideoId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let id = '';
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? '';
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
    else id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1] ?? '';
  }
  return /^[\w-]{11}$/.test(id) ? id : null;
}
