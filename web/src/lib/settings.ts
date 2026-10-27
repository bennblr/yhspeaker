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

export const HOTKEY_OPTIONS = [
  { value: '', label: 'Не назначено' },
  ...Array.from({ length: 9 }, (_, index) => ({
    value: `Alt+${index + 1}`,
    label: `Alt + ${index + 1}`,
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    value: `Control+Alt+${index + 1}`,
    label: `Ctrl + Alt + ${index + 1}`,
  })),
  ...Array.from({ length: 7 }, (_, index) => ({
    value: `F${index + 6}`,
    label: `F${index + 6}`,
  })),
];

const HOTKEY_VALUES = new Set(
  HOTKEY_OPTIONS.map((option) => option.value).filter((value) => value !== ''),
);

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
    typeof source.all === 'string' && (source.all === '' || HOTKEY_VALUES.has(source.all))
      ? source.all
      : DEFAULT_SETTINGS.broadcastKeys.all;
  const groups: Record<string, string> = {};
  if (source.groups && typeof source.groups === 'object') {
    for (const [id, accelerator] of Object.entries(source.groups)) {
      if (typeof accelerator === 'string' && HOTKEY_VALUES.has(accelerator)) {
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

export function isGlobalAccelerator(accelerator: string): boolean {
  return accelerator.includes('+');
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

  if (key === 'Space') return event.code === 'Space';
  if (/^[A-Z]$/.test(key)) return event.code === `Key${key}`;
  return event.key === key;
}

export function matchesPttRelease(event: KeyboardEvent, accelerator: string): boolean {
  const key = accelerator.split('+').pop() ?? '';
  if (key === 'Space') return event.code === 'Space';
  if (/^[A-Z]$/.test(key)) return event.code === `Key${key}`;
  return event.key === key;
}

export function describePttKey(accelerator: string): string {
  return PTT_OPTIONS.find((option) => option.value === accelerator)?.label ?? accelerator;
}
