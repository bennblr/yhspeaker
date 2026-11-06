import type { BroadcastMode } from './settings';

export interface DesktopWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
}

export interface BroadcastBinding {
  // 'all', id группы, либо 'priority:all' / 'priority:<id>' для приоритетного вещания.
  target: string;
  accelerator: string;
  mode: BroadcastMode;
}

export interface BroadcastStateEvent {
  target: string;
  active: boolean;
}

export type DesktopMicMode = 'voice' | 'ptt' | 'toggle';

export interface DesktopServerInfo {
  url: string;
  name: string;
  lastUsed: number;
  current: boolean;
}

export interface DesktopSwitchResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface DesktopMicState {
  inCall: boolean;
  on: boolean;
  muted: boolean;
  broadcasting: boolean;
  channelName: string;
}

export interface DesktopOverlayParticipant {
  sessionId: string;
  name: string;
  self: boolean;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  broadcasting: boolean;
  screen: boolean;
}

export interface DesktopOverlayState {
  channelName: string;
  participants: DesktopOverlayParticipant[];
}

export type DesktopOverlayAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'manual';

export interface DesktopOverlayPosition {
  x: number;
  y: number;
}

export interface DesktopOverlayConfig {
  enabled: boolean;
  anchor: DesktopOverlayAnchor;
  // Появилось вместе с ручным положением: сохранённые координаты и режим
  // перетаскивания. В старых клиентах этих полей нет.
  position?: DesktopOverlayPosition | null;
  editing?: boolean;
  // Появилось в клиенте 1.0.12: размер шрифта и цвет имён в оверлее.
  fontSize?: number;
  color?: string;
}

export interface DesktopScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon: string;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  setPttKey: (accelerator: string) => Promise<boolean>;
  setMicMode: (mode: DesktopMicMode) => Promise<DesktopMicMode>;
  setMicState: (state: DesktopMicState) => void;
  // Появилось в клиенте 1.0.7: оверлей канала поверх всех окон.
  setOverlayState?: (state: DesktopOverlayState | null) => void;
  // Появилось в клиенте 1.0.8: настройки оверлея из окна настроек.
  getOverlayConfig?: () => Promise<DesktopOverlayConfig>;
  setOverlayConfig?: (patch: Partial<DesktopOverlayConfig>) => Promise<DesktopOverlayConfig>;
  // Появилось в клиенте 1.0.11: ручное перетаскивание оверлея.
  setOverlayEditMode?: (editing: boolean) => Promise<DesktopOverlayConfig>;
  onOverlayConfig?: (callback: (config: DesktopOverlayConfig) => void) => () => void;
  // Появилось в клиенте 1.0.10: выбор экрана или окна для демонстрации.
  getScreenSources?: () => Promise<DesktopScreenSource[]>;
  selectScreenSource?: (sourceId: string) => Promise<boolean>;
  onPtt: (callback: (down: boolean) => void) => () => void;
  onMicToggle: (callback: () => void) => () => void;
  setBroadcastKeys: (bindings: BroadcastBinding[]) => Promise<number>;
  onBroadcastToggle: (callback: (target: string) => void) => () => void;
  // Появилось в клиенте 1.0.6: режим удержания для вещания. В старых
  // сборках этого метода нет, поэтому он необязательный.
  onBroadcastState?: (callback: (event: BroadcastStateEvent) => void) => () => void;
  hotkeysAvailable: () => Promise<boolean>;
  changeServer: () => void;
  listServers: () => Promise<DesktopServerInfo[]>;
  switchServer: (url: string) => Promise<DesktopSwitchResult>;
  setServerName: (name: string) => Promise<void>;
  getVersion: () => Promise<string>;
  windowControls: DesktopWindowControls;
}

// Клиенты до переименования (YHSpeak 1.0.x) экспонировали мост под старым
// именем и не знали части методов, которые вызывает новый веб-клиент.
type LegacyDesktopBridge = Omit<
  DesktopBridge,
  'setMicMode' | 'setMicState' | 'onMicToggle' | 'setServerName' | 'listServers' | 'switchServer'
>;

declare global {
  interface Window {
    la2speak?: DesktopBridge;
    yhspeak?: LegacyDesktopBridge;
  }
}

function withDefaults(bridge: LegacyDesktopBridge): DesktopBridge {
  const source = bridge as LegacyDesktopBridge & Partial<DesktopBridge>;
  return {
    ...source,
    setMicMode: source.setMicMode ?? (async (mode) => mode),
    setMicState: source.setMicState ?? (() => undefined),
    onMicToggle: source.onMicToggle ?? (() => () => undefined),
    setServerName: source.setServerName ?? (async () => undefined),
    listServers: source.listServers ?? (async () => []),
    switchServer:
      source.switchServer ?? (async () => ({ ok: false, error: 'Обновите приложение LA2Speak.' })),
  };
}

const bridge =
  typeof window === 'undefined' ? undefined : (window.la2speak ?? window.yhspeak);

export const desktop: DesktopBridge | null = bridge ? withDefaults(bridge) : null;
