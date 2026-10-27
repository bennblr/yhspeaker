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

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  setPttKey: (accelerator: string) => Promise<boolean>;
  onPtt: (callback: (down: boolean) => void) => () => void;
  setBroadcastKeys: (bindings: BroadcastBinding[]) => Promise<number>;
  onBroadcastToggle: (callback: (target: string) => void) => () => void;
  hotkeysAvailable: () => Promise<boolean>;
  changeServer: () => void;
  getVersion: () => Promise<string>;
  windowControls: DesktopWindowControls;
}

declare global {
  interface Window {
    yhspeak?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' && window.yhspeak ? window.yhspeak : null;
