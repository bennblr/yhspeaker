import crypto from 'node:crypto';
import type { DmParticipant } from '@tsds/shared';
import type { Store } from './store.js';

const MAX_BODY = 180;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
// Firebase присылает 404 с UNREGISTERED, когда приложение удалено или токен
// отозван. Такую запись хранить больше нет смысла.
const INVALID_TOKEN = /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/;

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function truncate(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_BODY ? `${trimmed.slice(0, MAX_BODY - 1)}…` : trimmed;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

// Уведомление о личном сообщении уходит в Firebase Cloud Messaging, чтобы
// приложение на телефоне просыпалось даже при заблокированном экране и
// выгруженном из памяти веб-клиенте. Ключи сервисного аккаунта задаются
// переменными окружения (см. README).
export class FcmService {
  private readonly account: ServiceAccount | null = null;
  private accessToken = '';
  private accessExpiresAt = 0;
  private pendingToken: Promise<string> | null = null;

  constructor(private readonly store: Store) {
    const projectId = process.env.FCM_PROJECT_ID?.trim();
    const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
    const privateKey = (process.env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();
    if (!projectId || !clientEmail || !privateKey) return;
    if (!privateKey.includes('PRIVATE KEY')) {
      console.warn('[fcm] FCM_PRIVATE_KEY не похож на ключ сервисного аккаунта');
      return;
    }
    this.account = { projectId, clientEmail, privateKey };
  }

  get available(): boolean {
    return this.account !== null;
  }

  register(userId: string, token: string, device?: string): void {
    this.store.saveFcmToken(userId, token, device);
  }

  unregister(userId: string, token: string): void {
    this.store.removeFcmToken(userId, token);
  }

  async notifyDirectMessage(
    toUserId: string,
    from: DmParticipant,
    text: string,
    ts: number,
  ): Promise<void> {
    if (!this.account) return;
    const tokens = this.store.fcmTokens(toUserId);
    if (tokens.length === 0) return;

    let token: string;
    try {
      token = await this.authorize();
    } catch (error) {
      console.warn('[fcm] не удалось получить токен доступа:', (error as Error).message);
      return;
    }

    const body = truncate(text);
    await Promise.all(
      tokens.map((item) => this.send(token, item.token, toUserId, from, body, ts)),
    );
  }

  private async authorize(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessExpiresAt) return this.accessToken;
    if (this.pendingToken) return this.pendingToken;

    this.pendingToken = this.requestToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async requestToken(): Promise<string> {
    const account = this.account;
    if (!account) throw new Error('FCM не настроен');

    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: account.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(account.privateKey);
    const assertion = `${header}.${claims}.${base64url(signature)}`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OAuth ${response.status}`);
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('OAuth не вернул access_token');
    this.accessToken = data.access_token;
    this.accessExpiresAt = Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000;
    return this.accessToken;
  }

  private async send(
    accessToken: string,
    deviceToken: string,
    toUserId: string,
    from: DmParticipant,
    body: string,
    ts: number,
  ): Promise<void> {
    const account = this.account;
    if (!account) return;

    const message = {
      message: {
        token: deviceToken,
        notification: { title: from.displayName, body },
        data: {
          type: 'dm',
          userId: from.id,
          ts: String(ts),
        },
        android: {
          priority: 'high',
          ttl: '86400s',
          notification: {
            channel_id: 'dm',
            icon: 'ic_stat_la2speak',
            color: '#6366f1',
            sound: 'default',
            click_action: 'ru.la2speak.mobile.OPEN_DM',
          },
        },
      },
    };

    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.ok) return;

      const text = await response.text().catch(() => '');
      if (response.status === 404 || INVALID_TOKEN.test(text)) {
        this.store.removeFcmToken(toUserId, deviceToken);
        return;
      }
      // Токен не печатаем: это фактически пароль на отправку уведомлений.
      console.warn(`[fcm] отправка не удалась (${response.status})`);
    } catch (error) {
      console.warn('[fcm] сеть недоступна:', (error as Error).message);
    }
  }
}
