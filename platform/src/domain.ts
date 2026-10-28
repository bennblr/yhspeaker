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

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'i',
  є: 'e',
  ґ: 'g',
};

export function slugifyHostLabel(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[а-яёіїєґ]/g, (char) => TRANSLIT[char] ?? '')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
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
