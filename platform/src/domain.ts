const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class DomainError extends Error {}

export function normalizeDomain(raw: string): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!DOMAIN_RE.test(value)) {
    throw new DomainError(`Некорректный домен: ${raw}`);
  }
  return value;
}

export function normalizeHostHeader(raw: string | undefined): string {
  if (!raw) return '';
  let value = raw.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    value = end >= 0 ? value.slice(0, end + 1) : value;
  } else {
    const colon = value.indexOf(':');
    if (colon >= 0) value = value.slice(0, colon);
  }
  return value.replace(/\.$/, '');
}
