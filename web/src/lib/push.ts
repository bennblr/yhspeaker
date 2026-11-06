import { api } from './api';
import { describeDevice } from './device';

// Флаг «пользователь включил уведомления на этом устройстве». Разрешение
// браузера само по себе не значит согласие: его можно выдать для другого сайта.
const ENABLED_KEY = 'la2speak.push.enabled';

export type PushStatusKind = 'ready' | 'install' | 'denied' | 'unsupported';

export interface PushStatus {
  kind: PushStatusKind;
  enabled: boolean;
  hint: string | null;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS представляется как Mac, но с сенсорным экраном.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function isStandalone(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(standalone) || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function supportsPush(): boolean {
  return (
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function base64ToBytes(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  // В dev-сервере воркер не регистрируется: не ждём вечно.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 4000)),
  ]);
}

// Причины, по которым включать нечего. Проверка синхронная, чтобы запрос
// разрешения ушёл прямо из обработчика нажатия.
function blockedStatus(): PushStatus | null {
  if (isIos() && !isStandalone()) {
    return {
      kind: 'install',
      enabled: false,
      hint:
        'На iPhone уведомления работают только у приложения с экрана «Домой». Добавьте LA2Speak на экран «Домой» и откройте его оттуда.',
    };
  }
  if (!supportsPush()) {
    return {
      kind: 'unsupported',
      enabled: false,
      hint: 'Браузер не поддерживает push-уведомления. Откройте приложение в Chrome или Safari.',
    };
  }
  if (Notification.permission === 'denied') {
    return {
      kind: 'denied',
      enabled: false,
      hint: 'Уведомления запрещены в настройках браузера или телефона. Разрешите их для LA2Speak и вернитесь сюда.',
    };
  }
  return null;
}

export async function getPushStatus(): Promise<PushStatus> {
  const blocked = blockedStatus();
  if (blocked) return blocked;
  const registration = await serviceWorker();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return {
    kind: 'ready',
    enabled: Boolean(subscription) && localStorage.getItem(ENABLED_KEY) === '1',
    hint: null,
  };
}

export async function enablePush(token: string): Promise<PushStatus> {
  const blocked = blockedStatus();
  if (blocked) return blocked;

  // Разрешение спрашиваем синхронно в обработчике нажатия: Safari на iPhone
  // теряет жест после первого await.
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
  if (permission !== 'granted') return getPushStatus();

  const registration = await serviceWorker();
  if (!registration) throw new Error('Приложение ещё готовится к работе. Перезагрузите его.');

  const { key } = await api.pushKey(token);
  if (!key) throw new Error('Уведомления недоступны на сервере');

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(key) as BufferSource,
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Браузер вернул некорректную подписку');
  }
  await api.pushSubscribe(token, {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    device: describeDevice().name,
  });
  localStorage.setItem(ENABLED_KEY, '1');
  return getPushStatus();
}

export async function disablePush(token: string): Promise<PushStatus> {
  localStorage.removeItem(ENABLED_KEY);
  const registration = await serviceWorker();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return getPushStatus();
  try {
    await api.pushUnsubscribe(token, subscription.endpoint);
  } catch {
    /* сервер всё равно отбросит подписку при следующем входе */
  }
  await subscription.unsubscribe().catch(() => false);
  return getPushStatus();
}

// Выход из аккаунта на общем телефоне не должен оставлять уведомления
// предыдущего пользователя.
export function forgetPushOnLogout(token: string | null): void {
  localStorage.removeItem(ENABLED_KEY);
  if (!token || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  void (async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      await api.pushUnsubscribe(token, subscription.endpoint).catch(() => undefined);
      await subscription.unsubscribe().catch(() => false);
    } catch {
      /* выход не должен зависеть от уведомлений */
    }
  })();
}

// При каждом запуске обновляем подписку на сервере: endpoint может смениться
// после обновления браузера, а ключи — после переустановки приложения.
export async function syncPushSubscription(token: string): Promise<void> {
  if (localStorage.getItem(ENABLED_KEY) !== '1') return;
  if (!supportsPush()) return;
  if (Notification.permission !== 'granted') {
    localStorage.removeItem(ENABLED_KEY);
    return;
  }
  try {
    const registration = await serviceWorker();
    if (!registration) return;
    const { key } = await api.pushKey(token);
    if (!key) return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(key) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
    await api.pushSubscribe(token, {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      device: describeDevice().name,
    });
  } catch {
    /* при следующем запуске попробуем снова */
  }
}

// Service worker присылает события клику по уведомлению и приходу сообщения,
// пока приложение открыто.
export function listenPushMessages(
  handler: (message: { type: string; userId: string }) => void,
): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; userId?: unknown } | null;
    if (!data || typeof data.type !== 'string' || typeof data.userId !== 'string') return;
    if (!data.userId) return;
    handler({ type: data.type, userId: data.userId });
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

export function pushNotificationTarget(): string | null {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('dm');
  return userId && userId.length > 0 ? userId : null;
}
