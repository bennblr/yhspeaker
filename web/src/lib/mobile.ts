import { api } from './api';
import { describeDevice } from './device';

// Мост в Android-приложение. Нативный слой добавляет объект La2speakAndroid
// до загрузки страницы и пересылает события через window.__la2speakNative.
// В обычном браузере объекта нет — весь модуль превращается в заглушку.

export interface MobileCallState {
  inCall: boolean;
  on: boolean;
  muted: boolean;
  broadcasting: boolean;
  channelName: string;
}

export type MobileEvent =
  | { type: 'mic-toggle' }
  | { type: 'voice-leave' }
  | { type: 'open-dm'; userId: string }
  | { type: 'push-token'; token: string }
  | { type: 'resume' }
  | { type: 'pause' }
  | { type: 'network'; online: boolean };

interface AndroidBridge {
  postMessage: (json: string) => void;
}

export interface MobileBridge {
  isMobile: true;
  platform: string;
  /** Сообщает службе, что звонок идёт: она держит микрофон и wakelock. */
  setCallState: (state: MobileCallState) => void;
  ready: () => void;
  requestNotifications: () => void;
  requestBatteryOptimization: () => void;
  requestPushToken: () => void;
  openExternal: (url: string) => void;
  onEvent: (listener: (event: MobileEvent) => void) => () => void;
}

const FCM_TOKEN_KEY = 'la2speak.fcm.token';

declare global {
  interface Window {
    La2speakAndroid?: AndroidBridge;
    __la2speakNative?: (event: MobileEvent) => void;
    __la2speakNativeQueue?: MobileEvent[];
  }
}

const listeners = new Set<(event: MobileEvent) => void>();

function dispatch(event: MobileEvent): void {
  for (const listener of listeners) listener(event);
}

if (typeof window !== 'undefined') {
  const queued = window.__la2speakNativeQueue;
  window.__la2speakNative = dispatch;
  if (Array.isArray(queued)) {
    for (const event of queued.splice(0, queued.length)) dispatch(event);
  }
}

function send(command: Record<string, unknown>): void {
  try {
    window.La2speakAndroid?.postMessage(JSON.stringify(command));
  } catch {
    /* мост недоступен — страница открыта в обычном браузере */
  }
}

export const mobile: MobileBridge | null =
  typeof window !== 'undefined' && window.La2speakAndroid
    ? {
        isMobile: true,
        platform: 'android',
        setCallState: (state) => send({ type: 'call-state', state }),
        ready: () => send({ type: 'ready' }),
        requestNotifications: () => send({ type: 'request-notifications' }),
        requestBatteryOptimization: () => send({ type: 'request-battery-optimization' }),
        requestPushToken: () => send({ type: 'request-push-token' }),
        openExternal: (url) => send({ type: 'open-url', url }),
        onEvent: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      }
    : null;

export function rememberFcmToken(token: string): void {
  try {
    localStorage.setItem(FCM_TOKEN_KEY, token);
  } catch {
    /* хранилище может быть отключено */
  }
}

export function storedFcmToken(): string | null {
  try {
    return localStorage.getItem(FCM_TOKEN_KEY);
  } catch {
    return null;
  }
}

// Токен FCM выдаёт Firebase и он одинаков для установки приложения. Сервер
// привязывает его к аккаунту, чтобы отправлять личные сообщения через FCM.
export async function syncFcmToken(apiToken: string, fcmToken: string): Promise<void> {
  if (!fcmToken) return;
  rememberFcmToken(fcmToken);
  try {
    await api.pushFcm(apiToken, fcmToken, describeDevice().name);
  } catch {
    /* сервер может быть без Firebase или без сети — повторим при следующем входе */
  }
}

export async function syncStoredFcmToken(apiToken: string): Promise<void> {
  if (!mobile) return;
  const stored = storedFcmToken();
  if (stored) {
    await syncFcmToken(apiToken, stored);
    return;
  }
  mobile.requestPushToken();
}

// Выход из аккаунта не должен оставлять уведомления прежнего пользователя.
export function forgetFcmOnLogout(apiToken: string | null): void {
  const token = storedFcmToken();
  try {
    localStorage.removeItem(FCM_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (!mobile || !apiToken || !token) return;
  void api.pushFcmRemove(apiToken, token).catch(() => undefined);
}
