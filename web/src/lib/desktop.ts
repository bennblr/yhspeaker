export interface DesktopWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
}

export interface BroadcastBinding {
  target: string;
  accelerator: string;
}

export type DesktopMicMode = 'open' | 'ptt' | 'toggle';

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

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  setPttKey: (accelerator: string) => Promise<boolean>;
  setMicMode: (mode: DesktopMicMode) => Promise<DesktopMicMode>;
  setMicState: (state: DesktopMicState) => void;
  onPtt: (callback: (down: boolean) => void) => () => void;
  onMicToggle: (callback: () => void) => () => void;
  setBroadcastKeys: (bindings: BroadcastBinding[]) => Promise<number>;
  onBroadcastToggle: (callback: (target: string) => void) => () => void;
  hotkeysAvailable: () => Promise<boolean>;
  changeServer: () => void;
  listServers: () => Promise<DesktopServerInfo[]>;
  switchServer: (url: string) => Promise<DesktopSwitchResult>;
  setServerName: (name: string) => Promise<void>;
  getVersion: () => Promise<string>;
  windowControls: DesktopWindowControls;
}

declare global {
  interface Window {
    la2speak?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' && window.la2speak ? window.la2speak : null;
