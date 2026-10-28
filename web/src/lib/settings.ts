export type PttMode = 'open' | 'ptt';

export interface BroadcastKeys {
  all: string;
  groups: Record<string, string>;
}

export interface MicSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputGain: number;
  micSensitivity: number;
  outputVolume: number;
  mode: PttMode;
  pttKey: string;
  broadcastKeys: BroadcastKeys;
}

export const PTT_OPTIONS = [
  { value: 'V', label: 'V', hint: 'когда окно активно' },
  { value: 'B', label: 'B', hint: 'когда окно активно' },
  { value: 'Space', label: 'Пробел', hint: 'когда окно активно' },
  { value: 'Alt+V', label: 'Alt + V', hint: 'глобально в приложении' },
  { value: 'Control+Space', label: 'Ctrl + Space', hint: 'глобально в приложении' },
];

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
]);

// Совпадает с именами клавиш uiohook-napi (UiohookKey), чтобы назначение
// из браузера работало и в глобальном хуке Windows.
const GLOBAL_SINGLE_KEYS = new Set([
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Insert',
  'Delete',
  'PrintScreen',
  'NumLock',
  'ScrollLock',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const NAMED_KEYS = new Set([
  ...GLOBAL_SINGLE_KEYS,
  'Backspace',
  'Tab',
  'Enter',
  'CapsLock',
  'Escape',
  'Space',
  'Semicolon',
  'Equal',
  'Comma',
  'Minus',
  'Period',
  'Slash',
  'Backquote',
  'BracketLeft',
  'Backslash',
  'BracketRight',
  'Quote',
  ...Array.from({ length: 10 }, (_, index) => `Numpad${index}`),
  'NumpadMultiply',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadDecimal',
  'NumpadDivide',
]);

const KEY_LABELS: Record<string, string> = {
  Space: 'Пробел',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const MODIFIER_LABELS: Record<string, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Win',
};

function isKeyToken(token: string): boolean {
  if (/^[A-Z]$/.test(token)) return true;
  if (/^[0-9]$/.test(token)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(token)) return true;
  return NAMED_KEYS.has(token);
}

export function isValidAccelerator(accelerator: string): boolean {
  if (!accelerator) return false;
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  if (!isKeyToken(key)) return false;
  const seen = new Set<string>();
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part) || seen.has(part)) return false;
    seen.add(part);
  }
  return true;
}

function tokenMatchesCode(token: string, code: string): boolean {
  if (/^[A-Z]$/.test(token)) return code === `Key${token}`;
  if (/^[0-9]$/.test(token)) return code === `Digit${token}`;
  return code === token;
}

function keyTokenFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(event.code)) return null;
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code;
  if (NAMED_KEYS.has(event.code)) return event.code;
  return null;
}

export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const token = keyTokenFromEvent(event);
  if (!token) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(token);
  return parts.join('+');
}

export function formatAccelerator(accelerator: string): string {
  if (!accelerator) return 'Не назначено';
  return accelerator
    .split('+')
    .map((part) => MODIFIER_LABELS[part] ?? KEY_LABELS[part] ?? part)
    .join(' + ');
}

export const DEFAULT_SETTINGS: MicSettings = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  inputGain: 1,
  micSensitivity: 65,
  outputVolume: 1,
  mode: 'open',
  pttKey: 'V',
  broadcastKeys: { all: 'Alt+1', groups: {} },
};

const STORAGE_KEY = 'yhspeak.settings.v1';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeBroadcastKeys(value: unknown): BroadcastKeys {
  const source = (value ?? {}) as Partial<BroadcastKeys>;
  const all =
    typeof source.all === 'string' && (source.all === '' || isValidAccelerator(source.all))
      ? source.all
      : DEFAULT_SETTINGS.broadcastKeys.all;
  const groups: Record<string, string> = {};
  if (source.groups && typeof source.groups === 'object') {
    for (const [id, accelerator] of Object.entries(source.groups)) {
      if (typeof accelerator === 'string' && isValidAccelerator(accelerator)) {
        groups[id] = accelerator;
      }
    }
  }
  return { all, groups };
}

export function loadSettings(): MicSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS, broadcastKeys: normalizeBroadcastKeys(undefined) };
    }
    const parsed = JSON.parse(raw) as Partial<MicSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      inputGain: clamp(Number(parsed.inputGain ?? 1), 0, 2),
      micSensitivity: clamp(Number(parsed.micSensitivity ?? 65), 0, 100),
      outputVolume: clamp(Number(parsed.outputVolume ?? 1), 0, 1),
      mode: parsed.mode === 'ptt' ? 'ptt' : 'open',
      pttKey: PTT_OPTIONS.some((option) => option.value === parsed.pttKey)
        ? (parsed.pttKey as string)
        : DEFAULT_SETTINGS.pttKey,
      broadcastKeys: normalizeBroadcastKeys(parsed.broadcastKeys),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, broadcastKeys: normalizeBroadcastKeys(undefined) };
  }
}

export function saveSettings(settings: MicSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

// Клавиши, которые в приложении для Windows можно повесить на глобальный хук:
// сочетания и служебные одиночные клавиши. Буквы и цифры без модификатора
// обрабатываются только при активном окне, чтобы не срабатывать при вводе текста.
export function isGlobalAccelerator(accelerator: string): boolean {
  if (!accelerator) return false;
  if (accelerator.includes('+')) return true;
  const token = accelerator.split('+').pop() ?? '';
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(token) || GLOBAL_SINGLE_KEYS.has(token);
}

// Больше значение — выше чувствительность: микрофон реагирует на более тихий голос.
export function sensitivityThreshold(sensitivity: number): number {
  const value = clamp(Number(sensitivity), 0, 100);
  return 0.003 * Math.pow(50, (100 - value) / 100);
}

export function micLevelPercent(level: number): number {
  return Math.min(100, Math.round(Math.sqrt(Math.max(0, level)) * 250));
}

export function matchesPttKey(event: KeyboardEvent, accelerator: string): boolean {
  if (!isValidAccelerator(accelerator)) return false;
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const needAlt = parts.includes('Alt');
  const needCtrl = parts.includes('Control') || parts.includes('CommandOrControl');
  const needShift = parts.includes('Shift');
  const needMeta = parts.includes('Meta');

  if (event.altKey !== needAlt) return false;
  if (event.ctrlKey !== needCtrl) return false;
  if (event.shiftKey !== needShift) return false;
  if (event.metaKey !== needMeta) return false;

  return tokenMatchesCode(key, event.code);
}

export function matchesPttRelease(event: KeyboardEvent, accelerator: string): boolean {
  if (!isValidAccelerator(accelerator)) return false;
  const key = accelerator.split('+').pop() ?? '';
  return tokenMatchesCode(key, event.code);
}

export function describePttKey(accelerator: string): string {
  return PTT_OPTIONS.find((option) => option.value === accelerator)?.label ?? accelerator;
}
