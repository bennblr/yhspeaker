export type PttMode = 'open' | 'ptt' | 'toggle';

// Как срабатывают горячие клавиши вещания: переключение (как раньше) или
// удержание, пока клавиша или кнопка мыши зажата.
export type BroadcastMode = 'toggle' | 'ptt';

// Предел индивидуальной громкости собеседника: 200% от обычного уровня.
export const MAX_USER_VOLUME = 2;

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
  broadcastMode: BroadcastMode;
  // Приоритетное вещание: те же цели и режимы, но пока оно активно,
  // слушатели не слышат никого, кроме вещающего.
  priorityKeys: BroadcastKeys;
  priorityMode: BroadcastMode;
}

// Кнопки мыши, которые можно назначить на микрофон. Средняя и две боковые:
// левая и правая заняты обычными действиями в приложении и играх.
// Значение — event.button в браузере (см. POINTER_BUTTONS).
const MOUSE_TOKENS = new Set(['Mouse3', 'Mouse4', 'Mouse5']);

const POINTER_BUTTONS: Record<number, string> = {
  1: 'Mouse3',
  3: 'Mouse4',
  4: 'Mouse5',
};

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
  Mouse3: 'Средняя кнопка мыши',
  Mouse4: 'Боковая кнопка мыши (назад)',
  Mouse5: 'Боковая кнопка мыши (вперёд)',
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

function isMouseToken(token: string): boolean {
  return MOUSE_TOKENS.has(token);
}

export function isValidAccelerator(accelerator: string): boolean {
  if (!accelerator) return false;
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  if (!isKeyToken(key) && !isMouseToken(key)) return false;
  const seen = new Set<string>();
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part) || seen.has(part)) return false;
    seen.add(part);
  }
  return true;
}

export function isMouseAccelerator(accelerator: string): boolean {
  const key = accelerator.split('+').pop() ?? '';
  return isMouseToken(key);
}

// В браузере дополнительные зажатые модификаторы не мешают срабатыванию:
// в игре легко держать Shift или Ctrl и при этом нажимать клавишу микрофона.
function modifiersMatch(
  event: { altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean },
  parts: string[],
): boolean {
  if (parts.includes('Alt') && !event.altKey) return false;
  if (parts.includes('Control') && !event.ctrlKey) return false;
  if (parts.includes('Shift') && !event.shiftKey) return false;
  if (parts.includes('Meta') && !event.metaKey) return false;
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

export function acceleratorFromPointer(event: PointerEvent): string | null {
  const token = POINTER_BUTTONS[event.button];
  if (!token) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(token);
  return parts.join('+');
}

export function matchesPointerKey(
  event: { button: number; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean },
  accelerator: string,
): boolean {
  if (!isValidAccelerator(accelerator)) return false;
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  if (POINTER_BUTTONS[event.button] !== key) return false;
  return modifiersMatch(event, parts);
}

// Отпускание кнопки мыши сверяем без модификаторов: их могли отпустить раньше.
export function matchesPointerRelease(
  event: { button: number },
  accelerator: string,
): boolean {
  if (!isValidAccelerator(accelerator)) return false;
  const key = accelerator.split('+').pop() ?? '';
  return POINTER_BUTTONS[event.button] === key;
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
  // Клавиши вещания по умолчанию не назначены: в приложении они глобальные
  // и в игре перехватывают управление, поэтому назначать их должен сам игрок.
  broadcastKeys: { all: '', groups: {} },
  broadcastMode: 'toggle',
  priorityKeys: { all: '', groups: {} },
  priorityMode: 'ptt',
};

const STORAGE_KEY = 'la2speak.settings.v1';

// «Alt+1» — прежнее значение по умолчанию: оно осело в сохранённых настройках
// у всех, кто менял любые другие параметры. Один раз чистим его, иначе
// «не назначено» было бы только у новых профилей. Метка не даёт стереть
// «Alt+1» тем, кто назначит его уже осознанно.
const LEGACY_DEFAULT_ALL_KEY = 'Alt+1';
const LEGACY_DEFAULT_MIGRATION_KEY = 'la2speak.migrated.broadcast-default';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Режим удержания для вещания появился в клиенте 1.0.6: старый клиент шлёт
// только переключение, поэтому сохранённое «Удержание» превращаем
// в «Переключение», иначе клавиша молча не работала бы.
function desktopSupportsBroadcastHold(): boolean {
  const bridge =
    typeof window !== 'undefined'
      ? (window as unknown as { la2speak?: { onBroadcastState?: unknown } }).la2speak
      : undefined;
  return !bridge || typeof bridge.onBroadcastState === 'function';
}

// Одна клавиша управляет только одной целью: второе назначение молча
// проигрывало первому. Приоритетные клавиши появились позже, поэтому при
// совпадении оставляем их приоритету, а клавишу микрофона не отдаём вещанию.
function uniqueBroadcastKeys(
  broadcastKeys: BroadcastKeys,
  priorityKeys: BroadcastKeys,
  pttKey: string,
): { broadcastKeys: BroadcastKeys; priorityKeys: BroadcastKeys } {
  const used = new Set([pttKey]);
  const take = (keys: BroadcastKeys): BroadcastKeys => {
    const all = keys.all && !used.has(keys.all) ? keys.all : '';
    if (all) used.add(all);
    const groups: Record<string, string> = {};
    for (const [id, accelerator] of Object.entries(keys.groups)) {
      if (used.has(accelerator)) continue;
      used.add(accelerator);
      groups[id] = accelerator;
    }
    return { all, groups };
  };
  const priority = take(priorityKeys);
  const broadcast = take(broadcastKeys);
  return { broadcastKeys: broadcast, priorityKeys: priority };
}

function settingsFromStorage(): MicSettings {
  const keys = uniqueBroadcastKeys(
    normalizeBroadcastKeys(undefined, DEFAULT_SETTINGS.broadcastKeys.all),
    normalizeBroadcastKeys(undefined, ''),
    DEFAULT_SETTINGS.pttKey,
  );
  return {
    ...DEFAULT_SETTINGS,
    ...keys,
    priorityMode: desktopSupportsBroadcastHold() ? DEFAULT_SETTINGS.priorityMode : 'toggle',
  };
}

function migratedLegacyDefault(): boolean {
  try {
    return localStorage.getItem(LEGACY_DEFAULT_MIGRATION_KEY) === '1';
  } catch {
    return true;
  }
}

function markLegacyDefaultMigrated(): void {
  try {
    localStorage.setItem(LEGACY_DEFAULT_MIGRATION_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

export function loadSettings(): MicSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return settingsFromStorage();
    const parsed = JSON.parse(raw) as Partial<MicSettings>;
    const pttKey =
      typeof parsed.pttKey === 'string' && isValidAccelerator(parsed.pttKey)
        ? parsed.pttKey
        : DEFAULT_SETTINGS.pttKey;
    const keys = uniqueBroadcastKeys(
      normalizeBroadcastKeys(parsed.broadcastKeys, DEFAULT_SETTINGS.broadcastKeys.all),
      normalizeBroadcastKeys(parsed.priorityKeys, ''),
      pttKey,
    );
    if (!migratedLegacyDefault()) {
      if (keys.broadcastKeys.all === LEGACY_DEFAULT_ALL_KEY) keys.broadcastKeys.all = '';
      markLegacyDefaultMigrated();
    }
    const holdSupported = desktopSupportsBroadcastHold();
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      inputGain: clamp(Number(parsed.inputGain ?? 1), 0, 2),
      micSensitivity: clamp(Number(parsed.micSensitivity ?? 65), 0, 100),
      outputVolume: clamp(Number(parsed.outputVolume ?? 1), 0, 1),
      mode:
        parsed.mode === 'ptt' ? 'ptt' : parsed.mode === 'toggle' ? 'toggle' : 'open',
      pttKey,
      ...keys,
      broadcastMode: holdSupported && parsed.broadcastMode === 'ptt' ? 'ptt' : 'toggle',
      priorityMode: holdSupported && parsed.priorityMode === 'ptt' ? 'ptt' : 'toggle',
    };
  } catch {
    return settingsFromStorage();
  }
}

function normalizeBroadcastKeys(value: unknown, fallbackAll: string): BroadcastKeys {
  const source = (value ?? {}) as Partial<BroadcastKeys>;
  const all =
    typeof source.all === 'string' && (source.all === '' || isValidAccelerator(source.all))
      ? source.all
      : fallbackAll;
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

export function saveSettings(settings: MicSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

// В приложении для Windows любая клавиша вещания регистрируется глобальным хуком:
// клавишу выбирают осознанно, и она должна срабатывать даже когда активно другое
// приложение. Одиночные клавиши без модификатора поэтому тоже работают везде —
// интерфейс предупреждает, что они сработают и при вводе текста.
export function isGlobalAccelerator(accelerator: string): boolean {
  return isValidAccelerator(accelerator);
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
  if (isMouseToken(key)) return false;
  if (!modifiersMatch(event, parts)) return false;
  return tokenMatchesCode(key, event.code);
}

export function matchesPttRelease(event: KeyboardEvent, accelerator: string): boolean {
  if (!isValidAccelerator(accelerator)) return false;
  const key = accelerator.split('+').pop() ?? '';
  if (isMouseToken(key)) return false;
  return tokenMatchesCode(key, event.code);
}
