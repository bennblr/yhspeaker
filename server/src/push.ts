import fs from 'node:fs';
import path from 'node:path';
import {
  WebPushError,
  generateVAPIDKeys,
  sendNotification,
  setVapidDetails,
} from 'web-push';
import type { DmParticipant } from '@tsds/shared';
import type { Store, StoredPushSubscription } from './store.js';

const KEYS_FILE = 'push-keys.json';
const MAX_BODY = 180;

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function isVapidPair(value: unknown): value is VapidKeys {
  if (!value || typeof value !== 'object') return false;
  const pair = value as Partial<VapidKeys>;
  return (
    typeof pair.publicKey === 'string' &&
    pair.publicKey.length > 20 &&
    typeof pair.privateKey === 'string' &&
    pair.privateKey.length > 20
  );
}

// Endpoint приходит от браузера, но его можно прислать вручную. Не даём
// серверу ходить по произвольным адресам: только HTTPS-хосты push-служб.
function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_BODY ? `${trimmed.slice(0, MAX_BODY - 1)}…` : trimmed;
}

export class PushService {
  private enabled = false;
  readonly publicKey: string = '';

  constructor(
    private readonly store: Store,
    dataDir: string,
  ) {
    const keys = this.resolveKeys(dataDir);
    if (!keys) return;
    try {
      const subject =
        process.env.VAPID_SUBJECT?.trim() || 'mailto:support@la2speak.com';
      setVapidDetails(subject, keys.publicKey, keys.privateKey);
      this.publicKey = keys.publicKey;
      this.enabled = true;
    } catch (error) {
      console.warn('[push] не удалось включить уведомления:', (error as Error).message);
    }
  }

  get available(): boolean {
    return this.enabled;
  }

  private resolveKeys(dataDir: string): VapidKeys | null {
    const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
    const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
    if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };

    const file = path.join(dataDir, KEYS_FILE);
    try {
      if (fs.existsSync(file)) {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (isVapidPair(parsed)) return parsed;
      }
    } catch (error) {
      console.warn('[push] не удалось прочитать ключи:', (error as Error).message);
    }

    try {
      const generated = generateVAPIDKeys();
      fs.writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
      return generated;
    } catch (error) {
      console.warn('[push] не удалось создать ключи:', (error as Error).message);
      return null;
    }
  }

  static validEndpoint(endpoint: string): boolean {
    return isPushEndpoint(endpoint);
  }

  subscribe(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string; device?: string },
  ): void {
    this.store.savePushSubscription(userId, input);
  }

  unsubscribe(userId: string, endpoint: string): void {
    this.store.removePushSubscription(userId, endpoint);
  }

  // Уведомление о личном сообщении уходит на все устройства аккаунта.
  // Открытое и активное приложение отфильтровывает сам service worker.
  async notifyDirectMessage(
    toUserId: string,
    from: DmParticipant,
    text: string,
    ts: number,
  ): Promise<void> {
    if (!this.enabled) return;
    const subscriptions = this.store.pushSubscriptions(toUserId);
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      type: 'dm',
      userId: from.id,
      title: from.displayName,
      body: truncate(text),
      ts,
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sendNotification(this.toWebPush(subscription), payload, {
            TTL: 24 * 60 * 60,
            urgency: 'high',
            contentEncoding: 'aes128gcm',
            timeout: 10_000,
          });
        } catch (error) {
          const status = error instanceof WebPushError ? error.statusCode : 0;
          if (status === 404 || status === 410) {
            this.store.removePushSubscription(toUserId, subscription.endpoint);
            return;
          }
          const host = (() => {
            try {
              return new URL(subscription.endpoint).hostname;
            } catch {
              return 'unknown';
            }
          })();
          console.warn(`[push] отправка не удалась (${host}, ${status || 'network'})`);
        }
      }),
    );
  }

  private toWebPush(subscription: StoredPushSubscription) {
    return {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
  }
}
