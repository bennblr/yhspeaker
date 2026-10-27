export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

const LEGACY_SERVER_NAMES = new Set(['tsds']);

// Старое имя сервера до переименования приложения.
export function serverLabel(name: string | null | undefined): string {
  const value = name?.trim();
  if (!value || LEGACY_SERVER_NAMES.has(value.toLowerCase())) return 'YHSpeak';
  return value;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function avatarHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
