import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  APP_VERSION,
  BASE_ROLES,
  BASE_ROLE_LABELS,
  MAX_CHANNEL_NAME,
  MAX_DISPLAY_NAME,
  MAX_GROUP_NAME,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_ROLE_NAME,
  hasAnyPermission,
  hasPermission,
  isChannelVisible,
  type BaseRole,
  type Channel,
  type DeviceInfo,
  type DeviceKind,
  type DirectMessage,
  type DmCandidate,
  type DmParticipant,
  type OnlineUser,
  type PermissionKey,
  type Role,
  type RolePermissions,
  type ServerSummary,
} from '@tsds/shared';
import {
  AuthService,
  hashChannelPassword,
  verifyChannelPassword,
  type Account,
} from './auth.js';
import { config } from './config.js';
import { SessionService } from './session.js';
import { StatsRecorder } from './stats.js';
import { Store } from './store.js';
import { PushService } from './push.js';
import { FcmService } from './fcm.js';
import { VoiceManager } from './voice.js';
import type { AppServer, AppSocket } from './types.js';

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const store = new Store(
  config.dataDir,
  config.guestInviteCode,
  config.guestInviteRequired,
  config.serverName,
);
const app = express();
const httpServer = http.createServer(app);
const io: AppServer = new Server(httpServer, {
  maxHttpBufferSize: 1_000_000,
  pingTimeout: 25_000,
});

const sessions = new SessionService(io);
const socketAccounts = new Map<string, Account>();
const stats = new StatsRecorder(sessions, config.dataDir);
const push = new PushService(store, config.dataDir);
const fcm = new FcmService(store);

const auth = new AuthService(store, config, (name) => {
  return (
    store.isIdentityTaken(name) ||
    sessions.list().some((user) => user.displayName.toLowerCase() === name.toLowerCase())
  );
});

const voice = new VoiceManager(io, config, store, sessions);

app.set('trust proxy', config.trustProxy ? 1 : false);
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), display-capture=(self)');
  next();
});

// ---------- rate limiting ----------

const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw new HttpError(429, 'Слишком много попыток. Попробуйте позже');
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}, 60_000).unref();

// ---------- helpers ----------

function accountFromRequest(req: Request): Account {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Требуется авторизация');
  const account = auth.verifyToken(token);
  if (!account) throw new HttpError(401, 'Сессия истекла, войдите заново');
  return account;
}

function rolesOf(serverId: string | null | undefined): Role[] {
  return serverId ? store.roles(serverId) : [];
}

function requirePermission(account: Account, permission: PermissionKey): void {
  if (!account.serverId || !hasPermission(account, rolesOf(account.serverId), permission)) {
    throw new HttpError(403, 'Недостаточно прав');
  }
}

function requireAnyPermission(account: Account, permissions: PermissionKey[]): void {
  const roles = rolesOf(account.serverId);
  if (
    !account.serverId ||
    !permissions.some((permission) => hasPermission(account, roles, permission))
  ) {
    throw new HttpError(403, 'Недостаточно прав');
  }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Некорректные данные');
  }
  return parsed.data;
}

const wrap =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Логин: минимум 3 символа')
    .max(24, 'Логин: максимум 24 символа')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Логин может содержать только латиницу, цифры, _ . -'),
  password: z.string().min(6, 'Пароль: минимум 6 символов').max(128, 'Пароль слишком длинный'),
  displayName: z
    .string()
    .trim()
    .min(2, 'Имя: минимум 2 символа')
    .max(MAX_DISPLAY_NAME, `Имя: максимум ${MAX_DISPLAY_NAME} символов`)
    .optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Введите логин'),
  password: z.string().min(1, 'Введите пароль'),
});

const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Имя: минимум 2 символа')
    .max(MAX_DISPLAY_NAME, `Имя: максимум ${MAX_DISPLAY_NAME} символов`),
});

const guestSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Имя: минимум 2 символа')
    .max(MAX_DISPLAY_NAME, `Имя: максимум ${MAX_DISPLAY_NAME} символов`),
  inviteCode: z.string().trim().max(64).optional(),
});

const inviteModeSchema = z.object({
  inviteRequired: z.boolean(),
});

const messageSchema = z.object({
  channelId: z.string().min(1),
  text: z
    .string()
    .trim()
    .min(1, 'Сообщение пустое')
    .max(MAX_MESSAGE_LENGTH, `Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов`),
});

const directMessageSchema = z.object({
  toUserId: z.string().min(1),
  text: z
    .string()
    .trim()
    .min(1, 'Сообщение пустое')
    .max(MAX_MESSAGE_LENGTH, `Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов`),
});

const pushSubscribeSchema = z.object({
  endpoint: z.string().trim().min(10).max(2048),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(512),
    auth: z.string().trim().min(1).max(512),
  }),
  device: z.string().trim().max(40).optional(),
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().min(10).max(2048),
});

const fcmTokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  device: z.string().trim().max(40).optional(),
});

const channelNameSchema = z
  .string()
  .trim()
  .min(1, 'Введите название канала')
  .max(MAX_CHANNEL_NAME, `Название: максимум ${MAX_CHANNEL_NAME} символов`);

const channelPasswordSchema = z
  .string()
  .max(64, 'Пароль канала: максимум 64 символа');

const channelVisibilitySchema = {
  visibleRoles: z.array(z.enum(['admin', 'moderator', 'member', 'guest'])).max(4).optional(),
  visibleRoleIds: z.array(z.string().min(1)).max(100).optional(),
};

const channelSchema = z.object({
  name: channelNameSchema,
  type: z.enum(['voice', 'text']),
  password: channelPasswordSchema.optional(),
  ...channelVisibilitySchema,
});

const channelUpdateSchema = z.object({
  channelId: z.string().min(1),
  name: channelNameSchema,
  password: channelPasswordSchema.optional(),
  ...channelVisibilitySchema,
});

const unlockSchema = z.object({
  channelId: z.string().min(1),
  password: z.string().max(128, 'Слишком длинный пароль'),
});

const broadcastGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Название группы: минимум 2 символа')
    .max(MAX_GROUP_NAME, `Название группы: максимум ${MAX_GROUP_NAME} символов`),
  memberIds: z
    .array(z.string().min(1))
    .min(1, 'Добавьте хотя бы одного участника')
    .max(500),
});

const rolePermissionsSchema = z.object({
  broadcast: z.boolean().default(false),
  moderate: z.boolean().default(false),
  channels: z.boolean().default(false),
  roles: z.boolean().default(false),
  groups: z.boolean().default(false),
  invite: z.boolean().default(false),
  createServer: z.boolean().default(false),
});

const roleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Название роли: минимум 2 символа')
    .max(MAX_ROLE_NAME, `Название роли: максимум ${MAX_ROLE_NAME} символов`),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Некорректный цвет роли'),
  permissions: rolePermissionsSchema,
});

function canSeeGroups(user: {
  role: Account['role'];
  roleIds?: string[];
  serverId?: string | null;
}): boolean {
  const roles = rolesOf(user.serverId);
  return (
    hasPermission(user, roles, 'groups') || hasPermission(user, roles, 'broadcast')
  );
}

function emitGroups(serverId: string): void {
  const groups = store.broadcastGroups(serverId);
  for (const user of sessions.listInServer(serverId)) {
    sessions
      .getSocket(user.sessionId)
      ?.emit('groups:update', canSeeGroups(user) ? groups : []);
  }
}

function channelsFor(user: {
  serverId?: string | null;
  role: BaseRole;
  roleIds?: string[];
}): Channel[] {
  if (!user.serverId) return [];
  return store.channels(user.serverId).filter((channel) => isChannelVisible(user, channel));
}

function canAccessChannel(
  user: { id: string; role: BaseRole; roleIds?: string[]; serverId?: string | null },
  channel: Channel,
): boolean {
  // Каналы другого сервера не существуют для этой сессии.
  if (!user.serverId || channel.serverId !== user.serverId) return false;
  if (!isChannelVisible(user, channel)) return false;
  if (user.role === 'admin') return true;
  const stored = store.channelById(channel.id);
  return !stored?.passwordHash || sessions.isChannelUnlocked(user.id, channel.id);
}

function normalizeVisibility(
  serverId: string,
  input: { visibleRoles?: BaseRole[]; visibleRoleIds?: string[] },
): { visibleRoles: BaseRole[]; visibleRoleIds: string[] } {
  const visibleRoles = [...new Set(input.visibleRoles ?? BASE_ROLES)];
  const known = new Set(store.roles(serverId).map((role) => role.id));
  const visibleRoleIds = [...new Set(input.visibleRoleIds ?? [])].filter((id) => known.has(id));
  return { visibleRoles, visibleRoleIds };
}

function emitChannels(serverId: string): void {
  for (const user of sessions.listInServer(serverId)) {
    sessions.getSocket(user.sessionId)?.emit('channels:update', channelsFor(user));
  }
}

// После смены роли или видимости канала отключает тех, кто потерял доступ.
async function enforceChannelAccess(): Promise<void> {
  for (const user of sessions.list()) {
    if (!user.channelId) continue;
    const channel = store.channelById(user.channelId);
    if (!channel) continue;
    const dto = store
      .channels(channel.serverId)
      .find((item) => item.id === channel.id);
    if (!dto || canAccessChannel(user, dto)) continue;
    await voice.kick(user.sessionId, 'система');
    sessions.getSocket(user.sessionId)?.emit('toast', {
      type: 'info',
      text: `Канал «${channel.name}» больше не доступен вам`,
    });
  }
}

// Роль и метка аккаунта зависят от сервера; для офлайн-собеседника берём
// тот общий сервер, где он состоит.
function memberView(userId: string): { role: BaseRole; roleIds: string[]; label?: string } {
  const membership = store.membership(store.preferredServerId(userId), userId);
  return {
    role: membership?.role ?? 'guest',
    roleIds: membership ? [...membership.roleIds] : [],
    label: membership?.label,
  };
}

// Собеседник личного чата: сначала берём живое подключение, чтобы ник и метка
// были актуальными, а для офлайн-аккаунта — сохранённый профиль.
function dmParticipant(userId: string): DmParticipant | null {
  const online = sessions.sessionsOf(userId)[0];
  if (online) {
    return {
      id: online.id,
      displayName: online.displayName,
      label: online.label,
      role: online.role,
    };
  }
  const stored = store.userById(userId);
  if (!stored) return null;
  const view = memberView(userId);
  return {
    id: stored.id,
    displayName: stored.displayName,
    label: view.label,
    role: view.role,
  };
}

// Аккаунты общих серверов плюс гости, которые есть только в живых сессиях.
// Офлайн-аккаунты остаются в списке: сообщение сохранится и дойдёт при входе.
function dmCandidates(userId: string): DmCandidate[] {
  const onlineByUser = new Map<string, OnlineUser>();
  for (const session of sessions.list()) {
    if (session.id !== userId && !onlineByUser.has(session.id)) {
      onlineByUser.set(session.id, session);
    }
  }

  const myServers = new Set(store.membershipsOf(userId).map((membership) => membership.serverId));
  const shared = store.sharedServerUserIds(userId);
  const candidates = new Map<string, DmCandidate>();
  for (const user of store.users()) {
    if (user.id === userId || user.banned || !shared.has(user.id)) continue;
    const online = onlineByUser.get(user.id);
    const membership = store
      .membershipsOf(user.id)
      .find((item) => myServers.has(item.serverId));
    candidates.set(user.id, {
      id: user.id,
      displayName: online?.displayName ?? user.displayName,
      label: membership?.label,
      role: membership?.role ?? 'guest',
      isGuest: false,
      roleIds: membership ? [...membership.roleIds] : [],
      online: Boolean(online),
      deviceName: online?.deviceName,
    });
  }

  for (const online of onlineByUser.values()) {
    if (candidates.has(online.id) || store.userById(online.id)) continue;
    if (!online.serverId || !myServers.has(online.serverId)) continue;
    candidates.set(online.id, {
      id: online.id,
      displayName: online.displayName,
      label: online.label,
      role: online.role,
      isGuest: online.isGuest,
      roleIds: online.roleIds,
      online: true,
      deviceName: online.deviceName,
    });
  }

  return [...candidates.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, 'ru');
  });
}

function channelSockets(channel: Channel) {
  return sessions
    .list()
    .filter((user) => canAccessChannel(user, channel))
    .map((user) => sessions.getSocket(user.sessionId));
}

function emitRoles(serverId: string): void {
  for (const user of sessions.listInServer(serverId)) {
    sessions.getSocket(user.sessionId)?.emit('roles:update', store.roles(serverId));
  }
}

function applyRoleLoss(userId: string, serverId: string, roleIds: string[]): void {
  if (sessions.hasAccount(userId)) {
    sessions.updateAccountInServer(userId, serverId, { roleIds });
  }
}

function groupMembers(serverId: string, ids: string[]): string[] {
  const members = [...new Set(ids)].filter((id) =>
    Boolean(store.membership(serverId, id)),
  );
  if (members.length === 0) {
    throw new HttpError(400, 'Выберите хотя бы одного зарегистрированного участника');
  }
  return members;
}

function publicConfig() {
  return {
    serverName: config.serverName,
    allowGuests: config.allowGuests,
    guestInviteRequired: store.guestInviteRequired,
    maxParticipants: config.maxParticipants,
    version: APP_VERSION,
  };
}

function clientConfigFor(account: Account) {
  return {
    ...publicConfig(),
    guestInviteCode: hasPermission(account, rolesOf(account.serverId), 'invite')
      ? store.inviteCode
      : undefined,
    maxMessageLength: MAX_MESSAGE_LENGTH,
  };
}

function emitConfig(): void {
  io.emit('config:update', publicConfig());
}

// ---------- серверы аккаунта ----------

function serverSummaries(account: Account): ServerSummary[] {
  const memberships = account.isGuest ? [] : store.membershipsOf(account.id);
  const canCreate = memberships.some((membership) =>
    hasPermission(
      { role: membership.role, roleIds: membership.roleIds },
      store.roles(membership.serverId),
      'createServer',
    ),
  );
  return store.serversOf(account.id).map((server) => {
    const membership = store.membership(server.id, account.id)!;
    const canInvite = hasPermission(
      { role: membership.role, roleIds: membership.roleIds },
      store.roles(server.id),
      'invite',
    );
    return {
      id: server.id,
      name: server.name,
      ownerId: server.ownerId,
      role: membership.role,
      memberCount: store.memberIds(server.id).length,
      canCreate,
      inviteCode: canInvite ? server.inviteCode : undefined,
      createdAt: server.createdAt,
    };
  });
}

function emitServers(userId: string): void {
  for (const online of sessions.sessionsOf(userId)) {
    const account = socketAccounts.get(online.sessionId);
    if (!account) continue;
    sessions
      .getSocket(online.sessionId)
      ?.emit('servers:update', serverSummaries(account));
  }
}

// Состав участников сервера меняется — обновляем счётчики у всех его участников.
function emitServersForMembers(serverId: string): void {
  for (const userId of store.memberIds(serverId)) emitServers(userId);
}

// Полное состояние подключения: его получает клиент при входе и после
// переключения сервера.
function sendInit(socket: AppSocket, account: Account): void {
  const online = sessions.get(socket.id);
  if (!online) return;
  const server = store.serverById(online.serverId);
  const visibleChannels = channelsFor(online);
  socket.emit('state:init', {
    me: online,
    users: sessions.listInServer(online.serverId),
    channels: visibleChannels,
    broadcastGroups: canSeeGroups(online) && online.serverId
      ? store.broadcastGroups(online.serverId)
      : [],
    roles: rolesOf(online.serverId),
    routerRtpCapabilities: voice.rtpCapabilities(),
    config: clientConfigFor(account),
    messageCounts: Object.fromEntries(
      visibleChannels.map((channel) => [channel.id, store.messageCount(channel.id)]),
    ),
    server: server ? { id: server.id, name: server.name } : null,
    servers: serverSummaries(account),
  });
}

// Переключение только меняет «окно» этой сессии: аккаунт, другие устройства
// и голосовые сессии на прежнем сервере не затрагиваются.
async function selectServer(
  socket: AppSocket,
  sessionId: string,
  account: Account,
  serverId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (account.isGuest) {
    return { ok: false, error: 'Гостям доступен только основной сервер' };
  }
  const membership = store.membership(serverId, account.id);
  if (!membership) return { ok: false, error: 'Вы не состоите на этом сервере' };
  if (account.serverId === serverId) return { ok: true };

  await voice.leave(sessionId);
  const next = auth.accountFor(store.userById(account.id)!, serverId);
  socketAccounts.set(socket.id, next);
  sessions.update(
    sessionId,
    {
      serverId: next.serverId,
      role: next.role,
      roleIds: [...next.roleIds],
      label: next.label,
    },
    false,
  );
  store.setLastServer(account.id, serverId);
  sessions.broadcastUsers();
  sendInit(socket, next);
  return { ok: true };
}

// ---------- devices ----------

const DEVICE_KINDS: DeviceKind[] = ['desktop', 'mobile', 'tablet'];

function guessDevice(userAgent: string | undefined): DeviceInfo {
  const ua = userAgent ?? '';
  if (/iPad|Tablet/i.test(ua)) return { kind: 'tablet', name: 'Планшет' };
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return { kind: 'mobile', name: 'Телефон' };
  if (/Macintosh/i.test(ua)) return { kind: 'desktop', name: 'macOS' };
  if (/Windows/i.test(ua)) return { kind: 'desktop', name: 'Windows' };
  if (/Linux/i.test(ua)) return { kind: 'desktop', name: 'Linux' };
  return { kind: 'desktop', name: 'Компьютер' };
}

// Клиент присылает своё название устройства; сервер проверяет и ограничивает его.
function deviceFromSocket(socket: AppSocket): DeviceInfo {
  const guessed = guessDevice(socket.handshake.headers['user-agent']);
  const raw = socket.handshake.auth?.device as Partial<DeviceInfo> | undefined;
  const kind = DEVICE_KINDS.includes(raw?.kind as DeviceKind)
    ? (raw?.kind as DeviceKind)
    : guessed.kind;
  const name =
    typeof raw?.name === 'string'
      ? raw.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40)
      : '';
  return { kind, name: name || guessed.name };
}

// ---------- REST ----------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: config.serverName,
    version: APP_VERSION,
    online: sessions.accountCount(),
    voice: voice.getStats(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

app.post(
  '/api/register',
  wrap(async (req, res) => {
    checkRateLimit(`register:${req.ip}`, 10, 60_000);
    const body = parseBody(registerSchema, req.body);
    const result = await auth.register(body).catch((error: unknown) => {
      throw new HttpError(400, error instanceof Error ? error.message : 'Не удалось зарегистрироваться');
    });
    res.json({ token: result.token });
  }),
);

app.post(
  '/api/login',
  wrap(async (req, res) => {
    checkRateLimit(`login:${req.ip}`, 60, 60_000);
    const body = parseBody(loginSchema, req.body);
    const result = await auth.login(body).catch((error: unknown) => {
      throw new HttpError(401, error instanceof Error ? error.message : 'Не удалось выполнить вход');
    });
    res.json({ token: result.token });
  }),
);

app.post(
  '/api/guest',
  wrap(async (req, res) => {
    checkRateLimit(`guest:${req.ip}`, 60, 60_000);
    const body = parseBody(guestSchema, req.body);
    try {
      const result = auth.guest(body.displayName, body.inviteCode);
      res.json({ token: result.token });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось войти гостем';
      throw new HttpError(message === 'Гостевой вход отключён' ? 403 : 400, message);
    }
  }),
);

app.get(
  '/api/me',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    res.json({ account });
  }),
);

// ---------- Web Push ----------

app.get(
  '/api/push/key',
  wrap((req, res) => {
    accountFromRequest(req);
    res.json({ key: push.available ? push.publicKey : null, fcm: fcm.available });
  }),
);

app.post(
  '/api/push/subscribe',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    if (!push.available) throw new HttpError(503, 'Уведомления недоступны на сервере');
    const body = parseBody(pushSubscribeSchema, req.body);
    if (!PushService.validEndpoint(body.endpoint)) {
      throw new HttpError(400, 'Некорректный адрес подписки');
    }
    push.subscribe(account.id, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      device: body.device,
    });
    res.json({ ok: true });
  }),
);

app.post(
  '/api/push/unsubscribe',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    const body = parseBody(pushUnsubscribeSchema, req.body);
    push.unsubscribe(account.id, body.endpoint);
    res.json({ ok: true });
  }),
);

// Токен FCM присылает Android-приложение. В отличие от Web Push, он не
// содержит endpoint и ключей — сервер сам собирает сообщение через Firebase.
app.post(
  '/api/push/fcm',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    if (!fcm.available) throw new HttpError(503, 'Уведомления недоступны на сервере');
    const body = parseBody(fcmTokenSchema, req.body);
    fcm.register(account.id, body.token, body.device);
    res.json({ ok: true });
  }),
);

app.post(
  '/api/push/fcm/remove',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    const body = parseBody(fcmTokenSchema, req.body);
    fcm.unregister(account.id, body.token);
    res.json({ ok: true });
  }),
);

app.patch(
  '/api/profile',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    if (account.isGuest) throw new HttpError(403, 'Гости не могут менять ник');
    const body = parseBody(profileSchema, req.body);
    const normalized = body.displayName.toLowerCase();
    const taken =
      store
        .users()
        .some(
          (user) =>
            user.id !== account.id &&
            (user.username.toLowerCase() === normalized ||
              user.displayName.toLowerCase() === normalized),
        ) ||
      sessions
        .list()
        .some((user) => user.id !== account.id && user.displayName.toLowerCase() === normalized);
    if (taken) throw new HttpError(409, 'Это имя уже используется');
    const updated = store.renameUser(account.id, body.displayName);
    if (!updated) throw new HttpError(404, 'Аккаунт не найден');
    sessions.updateAccount(account.id, { displayName: updated.displayName });
    res.json({ account: { ...account, displayName: updated.displayName } });
  }),
);

app.get(
  '/api/channels/:channelId/messages',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    const channel = store.channelById(req.params.channelId);
    if (!channel) throw new HttpError(404, 'Канал не найден');
    if (!canAccessChannel(account, channel)) {
      throw new HttpError(403, 'Канал недоступен');
    }
    if (account.isGuest) {
      res.json({ messages: [] });
      return;
    }
    const limit = Number.parseInt(String(req.query.limit ?? '100'), 10);
    res.json({ messages: store.messages(channel.id, Number.isFinite(limit) ? limit : 100) });
  }),
);

app.get(
  '/api/admin/users',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requireAnyPermission(account, ['moderate', 'roles', 'groups']);
    res.json({ users: store.adminUsers(account.serverId!) });
  }),
);

app.get(
  '/api/admin/stats',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'moderate');
    const raw = Number.parseInt(String(req.query.days ?? '7'), 10);
    const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, raw)) : 7;
    res.json({ stats: stats.summary(days), online: sessions.accountCount() });
  }),
);

app.get(
  '/api/admin/invite',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'invite');
    res.json({
      code: store.inviteCode,
      allowGuests: config.allowGuests,
      inviteRequired: store.guestInviteRequired,
    });
  }),
);

app.put(
  '/api/admin/invite',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'invite');
    const body = parseBody(inviteModeSchema, req.body);
    const inviteRequired = store.setGuestInviteRequired(body.inviteRequired);
    emitConfig();
    res.json({
      code: store.inviteCode,
      allowGuests: config.allowGuests,
      inviteRequired,
    });
  }),
);

app.post(
  '/api/admin/invite/regenerate',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'invite');
    res.json({ code: store.regenerateInviteCode() });
  }),
);

app.get(
  '/api/admin/groups',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    res.json({ groups: store.broadcastGroups(account.serverId!) });
  }),
);

app.post(
  '/api/admin/groups',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    const serverId = account.serverId!;
    const body = parseBody(broadcastGroupSchema, req.body);
    if (store.broadcastGroupByName(serverId, body.name)) {
      throw new HttpError(409, 'Группа с таким названием уже существует');
    }
    const group = store.createBroadcastGroup(
      serverId,
      body.name,
      groupMembers(serverId, body.memberIds),
    );
    emitGroups(serverId);
    res.json({ group });
  }),
);

app.put(
  '/api/admin/groups/:groupId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    const serverId = account.serverId!;
    const existing = store.broadcastGroupById(req.params.groupId);
    if (!existing || existing.serverId !== serverId) {
      throw new HttpError(404, 'Группа не найдена');
    }
    const body = parseBody(broadcastGroupSchema, req.body);
    if (store.broadcastGroupByName(serverId, body.name, existing.id)) {
      throw new HttpError(409, 'Группа с таким названием уже существует');
    }
    const group = store.updateBroadcastGroup(existing.id, {
      name: body.name,
      memberIds: groupMembers(serverId, body.memberIds),
    });
    emitGroups(serverId);
    voice.onBroadcastGroupsChanged(serverId);
    res.json({ group });
  }),
);

app.delete(
  '/api/admin/groups/:groupId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    const serverId = account.serverId!;
    const existing = store.broadcastGroupById(req.params.groupId);
    if (!existing || existing.serverId !== serverId || !store.deleteBroadcastGroup(existing.id)) {
      throw new HttpError(404, 'Группа не найдена');
    }
    emitGroups(serverId);
    voice.onBroadcastGroupsChanged(serverId);
    res.json({ ok: true });
  }),
);

// ---------- roles ----------

app.get(
  '/api/admin/roles',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    res.json({ roles: store.roles(account.serverId!) });
  }),
);

app.post(
  '/api/admin/roles',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    const serverId = account.serverId!;
    const body = parseBody(roleSchema, req.body);
    if (store.roleByName(serverId, body.name)) {
      throw new HttpError(409, 'Роль с таким названием уже существует');
    }
    const role = store.createRole(serverId, {
      name: body.name,
      color: body.color,
      permissions: body.permissions as RolePermissions,
    });
    emitRoles(serverId);
    res.json({ role });
  }),
);

app.put(
  '/api/admin/roles/:roleId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    const serverId = account.serverId!;
    const existing = store.roleById(req.params.roleId);
    if (!existing || existing.serverId !== serverId) {
      throw new HttpError(404, 'Роль не найдена');
    }
    const body = parseBody(roleSchema, req.body);
    if (store.roleByName(serverId, body.name, existing.id)) {
      throw new HttpError(409, 'Роль с таким названием уже существует');
    }
    const role = store.updateRole(existing.id, {
      name: body.name,
      color: body.color,
      permissions: body.permissions as RolePermissions,
    });
    emitRoles(serverId);
    emitGroups(serverId);
    voice.onPermissionsChanged(serverId);
    emitServers(account.id);
    res.json({ role });
  }),
);

app.delete(
  '/api/admin/roles/:roleId',
  wrap(async (req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    const serverId = account.serverId!;
    const existing = store.roleById(req.params.roleId);
    if (!existing || existing.serverId !== serverId) {
      throw new HttpError(404, 'Роль не найдена');
    }
    const affected = store.deleteRole(serverId, existing.id);
    for (const userId of affected) {
      const membership = store.membership(serverId, userId);
      if (membership) applyRoleLoss(userId, serverId, membership.roleIds);
    }
    sessions.broadcastUsers();
    emitRoles(serverId);
    emitChannels(serverId);
    emitGroups(serverId);
    voice.onPermissionsChanged(serverId);
    emitServers(account.id);
    await enforceChannelAccess();
    res.json({ ok: true });
  }),
);

// Код приглашения конкретного сервера: по нему новый участник входит
// в список серверов, не создавая отдельной учётной записи.
app.get(
  '/api/server/invite',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'invite');
    const server = store.serverById(account.serverId);
    if (!server) throw new HttpError(404, 'Сервер не найден');
    res.json({ code: server.inviteCode, name: server.name });
  }),
);

app.post(
  '/api/server/invite/regenerate',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'invite');
    const code = store.regenerateServerInvite(account.serverId!);
    if (!code) throw new HttpError(404, 'Сервер не найден');
    emitServers(account.id);
    res.json({ code });
  }),
);

// ---------- desktop app download ----------

function findDesktopInstaller(): { file: string; name: string; size: number } | null {
  try {
    const candidates = fs
      .readdirSync(config.desktopInstallerDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
      .map((entry) => {
        const file = path.join(config.desktopInstallerDir, entry.name);
        const stat = fs.statSync(file);
        return { file, name: entry.name, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const newest = candidates[0];
    return newest ? { file: newest.file, name: newest.name, size: newest.size } : null;
  } catch {
    return null;
  }
}

app.get('/api/desktop', (_req, res) => {
  const installer = findDesktopInstaller();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    available: Boolean(installer),
    fileName: installer?.name ?? null,
    size: installer?.size ?? 0,
  });
});

app.get('/download/windows', (_req, res) => {
  const installer = findDesktopInstaller();
  if (!installer) {
    res.status(404).type('text/plain').send('Установщик LA2Speak для Windows пока не загружен.');
    return;
  }
  res.download(installer.file, installer.name);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

// ---------- static web client ----------

const webDist = config.webDistDir;
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(
    express.static(webDist, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
        if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  console.warn(`[web] Сборка веб-клиента не найдена: ${webDist}. Запустите npm run build.`);
  app.get('/', (_req, res) => {
    res.type('text/plain').send('LA2Speak: веб-клиент ещё не собран. Выполните npm run build.');
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error('[http] unhandled error', error);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ---------- socket.io ----------

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || !token) {
    next(new Error('UNAUTHORIZED'));
    return;
  }
  const account = auth.verifyToken(token);
  if (!account) {
    next(new Error('UNAUTHORIZED'));
    return;
  }
  socket.data.userId = account.id;
  socket.data.device = deviceFromSocket(socket);
  socketAccounts.set(socket.id, account);
  next();
});

io.on('connection', async (socket: AppSocket) => {
  const account = socketAccounts.get(socket.id);
  if (!account) {
    socket.disconnect(true);
    return;
  }
  const userId = account.id;
  // Каждое подключение — отдельная сессия; аккаунт может быть в сети с нескольких устройств.
  const sessionId = socket.id;
  const device = socket.data.device ?? guessDevice(undefined);

  sessions.register(socket, account, device);
  // Продлеваем сессию при каждом подключении, чтобы активный пользователь
  // не вводил пароль заново по истечении срока токена.
  socket.emit('session:token', { token: auth.refreshToken(account) });
  sendInit(socket, account);

  const chatTimestamps: number[] = [];

  const safe = (handler: (...args: any[]) => Promise<void>) => {
    return (...args: any[]) => {
      handler(...args).catch((error) => {
        console.error('[socket] handler error', error);
        socket.emit('toast', { type: 'error', text: 'Внутренняя ошибка сервера' });
      });
    };
  };

  const currentAccount = (): Account => socketAccounts.get(socket.id) ?? account;

  socket.on(
    'server:select',
    safe(async (payload, ack) => {
      const serverId = typeof payload?.serverId === 'string' ? payload.serverId : '';
      if (!serverId) {
        ack?.({ ok: false, error: 'Сервер не выбран' });
        return;
      }
      const result = await selectServer(socket, sessionId, currentAccount(), serverId);
      ack?.(result);
    }),
  );

  socket.on(
    'server:create',
    safe(async (payload, ack) => {
      const me = currentAccount();
      if (me.isGuest) {
        ack?.({ ok: false, error: 'Гостям нельзя создавать серверы' });
        return;
      }
      const name = typeof payload?.name === 'string' ? payload.name.trim().slice(0, 40) : '';
      if (name.length < 2) {
        ack?.({ ok: false, error: 'Название сервера: минимум 2 символа' });
        return;
      }
      const allowed = store.membershipsOf(me.id).some((membership) =>
        hasPermission(
          { role: membership.role, roleIds: membership.roleIds },
          store.roles(membership.serverId),
          'createServer',
        ),
      );
      if (!allowed) {
        ack?.({ ok: false, error: 'Создавать серверы может только участник с этим правом' });
        return;
      }
      const server = store.createServer(name, me.id);
      const result = await selectServer(socket, sessionId, me, server.id);
      emitServers(me.id);
      ack?.(result.ok ? { ok: true, serverId: server.id } : result);
    }),
  );

  socket.on(
    'server:join',
    safe(async (payload, ack) => {
      const me = currentAccount();
      if (me.isGuest) {
        ack?.({ ok: false, error: 'Гостям доступен только основной сервер' });
        return;
      }
      const code = typeof payload?.code === 'string' ? payload.code.trim() : '';
      const server = store.serverByInviteCode(code);
      if (!server) {
        ack?.({ ok: false, error: 'Приглашение не найдено или устарело' });
        return;
      }
      if (!store.membership(server.id, me.id)) {
        store.addMember(server.id, me.id, 'member');
      }
      const result = await selectServer(socket, sessionId, me, server.id);
      emitServersForMembers(server.id);
      ack?.(result.ok ? { ok: true, serverId: server.id } : result);
    }),
  );

  socket.on(
    'server:leave',
    safe(async (payload, ack) => {
      const me = currentAccount();
      const serverId = typeof payload?.serverId === 'string' ? payload.serverId : '';
      const server = store.serverById(serverId);
      if (!server) {
        ack?.({ ok: false, error: 'Сервер не найден' });
        return;
      }
      if (server.id === store.defaultServerId()) {
        ack?.({ ok: false, error: 'Основной сервер покинуть нельзя' });
        return;
      }
      if (server.ownerId === me.id) {
        ack?.({ ok: false, error: 'Владелец не может покинуть сервер — передайте владение' });
        return;
      }
      if (!store.membership(server.id, me.id)) {
        ack?.({ ok: false, error: 'Вы не состоите на этом сервере' });
        return;
      }
      store.removeMember(server.id, me.id);
      // Устройства, которые смотрели этот сервер, возвращаем на основной.
      const fallbackId = store.defaultServerId();
      for (const online of sessions.sessionsOf(me.id)) {
        if (online.serverId !== server.id) continue;
        const onlineSocket = sessions.getSocket(online.sessionId);
        const onlineAccount = socketAccounts.get(online.sessionId);
        if (!onlineSocket || !onlineAccount) continue;
        await selectServer(onlineSocket, online.sessionId, onlineAccount, fallbackId);
      }
      emitServersForMembers(server.id);
      emitServers(me.id);
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'voice:join',
    safe(async ({ channelId }, ack) => {
      const result = await voice.join(socket, sessionId, channelId);
      if (!result.ok && result.error) socket.emit('voice:joinFailed', { message: result.error });
      ack?.(result);
    }),
  );

  socket.on(
    'voice:leave',
    safe(async () => {
      await voice.leave(sessionId);
    }),
  );

  socket.on(
    'voice:connectTransport',
    safe(async ({ direction, dtlsParameters }, ack) => {
      const result = await voice.connectTransport(sessionId, direction, dtlsParameters);
      ack?.(result);
    }),
  );

  socket.on(
    'voice:ready',
    safe(async ({ rtpCapabilities }, ack) => {
      const result = await voice.ready(sessionId, rtpCapabilities);
      ack?.(result);
    }),
  );

  socket.on(
    'voice:produce',
    safe(async ({ kind, rtpParameters, source }, ack) => {
      const result = await voice.produce(sessionId, kind, rtpParameters, source);
      ack(result);
    }),
  );

  socket.on(
    'voice:closeProducer',
    safe(async ({ producerId }) => {
      await voice.closeProducer(sessionId, producerId);
    }),
  );

  socket.on(
    'voice:resumeConsumer',
    safe(async ({ consumerId }, ack) => {
      const result = await voice.resumeConsumer(sessionId, String(consumerId ?? ''));
      ack?.(result);
    }),
  );

  socket.on('voice:setMuted', ({ muted }) => {
    if (!sessions.has(sessionId)) return;
    sessions.update(sessionId, { muted: Boolean(muted) });
  });

  socket.on('voice:setDeafened', ({ deafened }) => {
    if (!sessions.has(sessionId)) return;
    sessions.update(sessionId, { deafened: Boolean(deafened) });
  });

  socket.on(
    'voice:setBroadcast',
    safe(async (payload, ack) => {
      const all = Boolean(payload?.all);
      const groupIds = Array.isArray(payload?.groupIds)
        ? payload.groupIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const result = await voice.setBroadcast(sessionId, {
        all,
        groupIds,
        priority: Boolean(payload?.priority),
      });
      if (!result.ok && result.error) socket.emit('toast', { type: 'error', text: result.error });
      ack?.(result);
    }),
  );

  socket.on('chat:send', (payload, ack) => {
    try {
      const me = sessions.get(sessionId);
      if (!me) throw new HttpError(401, 'Сессия не найдена');
      const body = parseBody(messageSchema, payload);
      const channel = store.channelById(body.channelId);
      if (!channel) throw new HttpError(404, 'Канал не найден');
      if (!canAccessChannel(me, channel)) throw new HttpError(403, 'Канал недоступен');

      const now = Date.now();
      while (chatTimestamps.length && now - chatTimestamps[0] > 5000) chatTimestamps.shift();
      if (chatTimestamps.length >= 8) throw new HttpError(429, 'Слишком часто. Подождите немного');
      chatTimestamps.push(now);

      const message = {
        id: crypto.randomUUID(),
        channelId: channel.id,
        userId,
        displayName: me.displayName,
        label: me.label,
        role: me.role,
        text: body.text,
        ts: now,
      };
      store.addMessage(message);
      for (const socket of channelSockets(channel)) socket?.emit('chat:message', message);
      ack?.({ ok: true });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'Не удалось отправить сообщение';
      ack?.({ ok: false, error: message });
    }
  });

  // Личные сообщения получают только отправитель и адресат (на всех их
  // устройствах). История хранится в store.json и переживает перезапуск.
  socket.on('dm:send', (payload, ack) => {
    try {
      const me = sessions.get(sessionId);
      if (!me) throw new HttpError(401, 'Сессия не найдена');
      const body = parseBody(directMessageSchema, payload);
      if (body.toUserId === userId) throw new HttpError(400, 'Нельзя написать самому себе');
      const to = dmParticipant(body.toUserId);
      const from = dmParticipant(userId);
      if (!to || !from) throw new HttpError(404, 'Получатель не найден');

      const now = Date.now();
      while (chatTimestamps.length && now - chatTimestamps[0] > 5000) chatTimestamps.shift();
      if (chatTimestamps.length >= 8) throw new HttpError(429, 'Слишком часто. Подождите немного');
      chatTimestamps.push(now);

      const message: DirectMessage = {
        id: crypto.randomUUID(),
        from,
        to,
        text: body.text,
        ts: now,
      };
      store.addDirectMessage(message);
      for (const target of new Set([...sessions.socketsOf(userId), ...sessions.socketsOf(to.id)])) {
        target.emit('dm:message', message);
      }
      // Даже при закрытом приложении на телефоне уведомление придёт через
      // сервис-воркер: сокет для этого не нужен. Android-приложение получает
      // то же сообщение через Firebase, включая заблокированный экран.
      void push.notifyDirectMessage(to.id, from, message.text, message.ts);
      void fcm.notifyDirectMessage(to.id, from, message.text, message.ts);
      ack?.({ ok: true });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'Не удалось отправить сообщение';
      ack?.({ ok: false, error: message });
    }
  });

  socket.on('dm:list', (ack) => {
    try {
      ack?.({ ok: true, conversations: store.dmConversations(userId) });
    } catch {
      ack?.({ ok: false, error: 'Не удалось загрузить личные сообщения' });
    }
  });

  socket.on('dm:participants', (ack) => {
    try {
      ack?.({ ok: true, participants: dmCandidates(userId) });
    } catch {
      ack?.({ ok: false, error: 'Не удалось загрузить участников' });
    }
  });

  socket.on(
    'dm:history',
    safe(async ({ userId: peerId }, ack) => {
      if (typeof peerId !== 'string' || !peerId) {
        ack?.({ ok: false, error: 'Собеседник не выбран' });
        return;
      }
      ack?.({ ok: true, messages: store.directMessages(userId, peerId) });
    }),
  );

  socket.on(
    'admin:deleteMessage',
    safe(async ({ channelId, messageId }) => {
      const me = sessions.get(sessionId);
      if (!me || !hasPermission(me, rolesOf(me.serverId), 'moderate')) return;
      const channel = store.channelById(channelId);
      if (!channel || channel.serverId !== me.serverId) return;
      if (store.deleteMessage(channelId, messageId)) {
        for (const target of channelSockets(channel)) {
          target?.emit('chat:deleted', { channelId, messageId });
        }
      }
    }),
  );

  socket.on(
    'channel:unlock',
    safe(async (payload, ack) => {
      const me = sessions.get(sessionId);
      if (!me) {
        ack?.({ ok: false, error: 'Сессия не найдена' });
        return;
      }
      const body = parseBody(unlockSchema, payload);
      const channel = store.channelById(body.channelId);
      if (!channel || channel.serverId !== me.serverId) {
        ack?.({ ok: false, error: 'Канал не найден' });
        return;
      }
      if (!isChannelVisible(me, channel)) {
        ack?.({ ok: false, error: 'Канал недоступен' });
        return;
      }
      if (!channel.passwordHash || me.role === 'admin') {
        sessions.unlockChannel(userId, channel.id);
        ack?.({ ok: true });
        return;
      }
      try {
        checkRateLimit(`unlock:${userId}`, 10, 60_000);
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof HttpError ? error.message : 'Слишком много попыток',
        });
        return;
      }
      const valid = await verifyChannelPassword(body.password, channel.passwordHash);
      if (!valid) {
        ack?.({ ok: false, error: 'Неверный пароль канала' });
        return;
      }
      attempts.delete(`unlock:${userId}`);
      sessions.unlockChannel(userId, channel.id);
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'admin:createChannel',
    safe(async (payload, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'channels')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const body = parseBody(channelSchema, payload);
      if (store.channelByName(serverId, body.name)) {
        ack?.({ ok: false, error: 'Канал с таким названием уже существует' });
        return;
      }
      const password = body.password?.trim() ?? '';
      const passwordHash = password ? await hashChannelPassword(password) : undefined;
      store.createChannel(serverId, body.name, body.type, passwordHash, normalizeVisibility(serverId, body));
      emitChannels(serverId);
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'admin:updateChannel',
    safe(async (payload, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'channels')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const body = parseBody(channelUpdateSchema, payload);
      const channel = store.channelById(body.channelId);
      if (!channel || channel.serverId !== serverId) {
        ack?.({ ok: false, error: 'Канал не найден' });
        return;
      }
      if (store.channelByName(serverId, body.name, channel.id)) {
        ack?.({ ok: false, error: 'Канал с таким названием уже существует' });
        return;
      }
      let passwordHash: string | null | undefined;
      if (body.password !== undefined) {
        const password = body.password.trim();
        if (channel.guest && password) {
          ack?.({ ok: false, error: 'Гостевой канал не может быть защищён паролем' });
          return;
        }
        passwordHash = password ? await hashChannelPassword(password) : null;
      }
      const normalized = normalizeVisibility(serverId, body);
      store.updateChannel(channel.id, {
        name: body.name,
        passwordHash,
        ...(channel.guest
          ? { visibleRoles: [...BASE_ROLES], visibleRoleIds: [] }
          : {
              ...(body.visibleRoles !== undefined
                ? { visibleRoles: normalized.visibleRoles }
                : {}),
              ...(body.visibleRoleIds !== undefined
                ? { visibleRoleIds: normalized.visibleRoleIds }
                : {}),
            }),
      });
      const updated = store.channels(serverId).find((item) => item.id === channel.id);
      if (updated) {
        const wasProtected = Boolean(channel.passwordHash);
        for (const user of sessions.listInServer(serverId)) {
          if (user.channelId !== channel.id) continue;
          if (user.role === 'admin') continue;
          if (canAccessChannel(user, updated)) continue;
          await voice.kick(user.sessionId, 'система');
          sessions.getSocket(user.sessionId)?.emit('toast', {
            type: 'info',
            text:
              typeof passwordHash === 'string' && !wasProtected
                ? `Канал «${channel.name}» защищён паролем`
                : `Канал «${channel.name}» больше не доступен вам`,
          });
        }
      }
      emitChannels(serverId);
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'admin:deleteChannel',
    safe(async ({ channelId }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'channels')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const channel = store.channelById(channelId);
      if (!channel || channel.serverId !== serverId) {
        ack?.({ ok: false, error: 'Канал не найден' });
        return;
      }
      if (channel.guest) {
        ack?.({ ok: false, error: 'Гостевой канал создаётся автоматически и не удаляется' });
        return;
      }
      for (const user of sessions.listInServer(serverId)) {
        if (user.channelId === channelId) {
          await voice.kick(user.sessionId, 'система');
          sessions.getSocket(user.sessionId)?.emit('toast', {
            type: 'info',
            text: `Канал «${channel.name}» удалён`,
          });
        }
      }
      store.deleteChannel(channelId);
      sessions.clearChannelUnlocks(channelId);
      emitChannels(serverId);
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:serverMute',
    safe(async ({ userId: targetId, muted }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const targets = sessions
        .sessionsOf(targetId)
        .filter((item) => item.serverId === serverId);
      if (targets.length === 0) {
        ack?.({ ok: false, error: 'Пользователь не в сети' });
        return;
      }
      const target = targets[0];
      if (
        me.role === 'moderator' &&
        (target.role === 'admin' || target.role === 'moderator')
      ) {
        ack?.({ ok: false, error: 'Модератор не может управлять администраторами' });
        return;
      }
      await voice.applyServerMute(targetId, serverId, Boolean(muted));
      for (const item of targets) {
        sessions.getSocket(item.sessionId)?.emit('toast', {
          type: muted ? 'info' : 'ok',
          text: muted
            ? 'Администратор отключил ваш микрофон'
            : 'Администратор вернул вам микрофон',
        });
      }
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:kick',
    safe(async ({ userId: targetId, sessionId: targetSessionId }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Нельзя выгнать самого себя' });
        return;
      }
      const targets = sessions
        .sessionsOf(targetId)
        .filter((item) => item.serverId === me.serverId)
        .filter((item) => item.channelId)
        .filter((item) => !targetSessionId || item.sessionId === targetSessionId);
      if (targets.length === 0) {
        ack?.({ ok: false, error: 'Пользователь не в голосовом канале' });
        return;
      }
      const target = targets[0];
      if (
        me.role === 'moderator' &&
        (target.role === 'admin' || target.role === 'moderator')
      ) {
        ack?.({ ok: false, error: 'Модератор не может управлять администраторами' });
        return;
      }
      for (const item of targets) {
        await voice.kick(item.sessionId, me.displayName);
      }
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:moveUser',
    safe(async ({ userId: targetId, sessionId: targetSessionId, channelId }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Переключите себя через список каналов' });
        return;
      }
      const targets = sessions
        .sessionsOf(targetId)
        .filter((item) => item.serverId === me.serverId)
        .filter((item) => !targetSessionId || item.sessionId === targetSessionId);
      if (targets.length === 0) {
        ack?.({ ok: false, error: 'Пользователь не в сети' });
        return;
      }
      const target = targets[0];
      if (!target.channelId) {
        ack?.({ ok: false, error: 'Пользователь не в голосовом канале' });
        return;
      }
      if (
        me.role === 'moderator' &&
        (target.role === 'admin' || target.role === 'moderator')
      ) {
        ack?.({ ok: false, error: 'Модератор не может перемещать администраторов' });
        return;
      }
      const channel = store
        .channels(me.serverId)
        .find((item) => item.id === channelId);
      if (!channel || channel.type !== 'voice') {
        ack?.({ ok: false, error: 'Голосовой канал не найден' });
        return;
      }
      if (!isChannelVisible(target, channel)) {
        ack?.({ ok: false, error: 'Этот канал недоступен пользователю' });
        return;
      }
      if (
        channel.passwordProtected &&
        target.role !== 'admin' &&
        !sessions.isChannelUnlocked(targetId, channel.id)
      ) {
        ack?.({ ok: false, error: 'Канал защищён паролем' });
        return;
      }
      for (const item of targets) {
        if (!item.channelId || item.channelId === channel.id) continue;
        await voice.leave(item.sessionId);
        sessions.getSocket(item.sessionId)?.emit('voice:moved', {
          channelId: channel.id,
          channelName: channel.name,
          byName: me.displayName,
        });
      }
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:ban',
    safe(async ({ userId: targetId, banned }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || me.role !== 'admin') {
        ack?.({ ok: false, error: 'Блокировка доступна только администратору сервера' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Нельзя заблокировать самого себя' });
        return;
      }
      const target = store.userById(targetId);
      if (!target) {
        ack?.({ ok: false, error: 'Можно блокировать только зарегистрированных пользователей' });
        return;
      }
      const membership = store.membership(me.serverId, targetId);
      if (!membership || membership.role === 'admin') {
        ack?.({ ok: false, error: 'Нельзя блокировать администратора' });
        return;
      }
      store.setBanned(targetId, Boolean(banned));
      if (banned) {
        sessions.endAccount(targetId, 'Вы заблокированы администратором');
      }
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:deleteUser',
    safe(async ({ userId: targetId }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || me.role !== 'admin') {
        ack?.({ ok: false, error: 'Удалять аккаунты может только администратор' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Нельзя удалить собственный аккаунт' });
        return;
      }
      const target = store.userById(targetId);
      const membership = store.membership(me.serverId, targetId);
      if (!target || !membership) {
        ack?.({ ok: false, error: 'Аккаунт не найден на этом сервере' });
        return;
      }
      if (membership.role === 'admin' && store.countAdmins(me.serverId) <= 1) {
        ack?.({ ok: false, error: 'Нельзя удалить последнего администратора' });
        return;
      }
      store.deleteUser(targetId);
      sessions.endAccount(targetId, 'Аккаунт удалён администратором');
      for (const server of store.servers()) {
        emitGroups(server.id);
        voice.onBroadcastGroupsChanged(server.id);
      }
      sessions.broadcastUsers();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:setRole',
    safe(async ({ userId: targetId, role }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || (me.role !== 'admin' && me.role !== 'moderator')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Нельзя изменить свою роль' });
        return;
      }
      const nextRole = role as BaseRole;
      if (!BASE_ROLES.includes(nextRole)) {
        ack?.({ ok: false, error: 'Некорректная роль' });
        return;
      }
      const serverId = me.serverId;
      const target = store.userById(targetId);
      const membership = store.membership(serverId, targetId);
      if (!target || !membership) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      if (me.role === 'moderator' && (membership.role !== 'guest' || nextRole !== 'member')) {
        ack?.({
          ok: false,
          error: 'Модератор может назначить гостю только роль Пользователь',
        });
        return;
      }
      if (membership.role === 'admin' && nextRole !== 'admin' && store.countAdmins(serverId) <= 1) {
        ack?.({ ok: false, error: 'Нельзя снять роль у последнего администратора' });
        return;
      }
      if (membership.role !== nextRole) {
        store.setRole(serverId, targetId, nextRole);
        if (sessions.hasAccount(targetId)) {
          sessions.updateAccountInServer(targetId, serverId, { role: nextRole }, false);
        }
        sessions.broadcastUsers();
        for (const online of sessions.sessionsOf(targetId)) {
          if (online.serverId !== serverId) continue;
          sessions.getSocket(online.sessionId)?.emit('toast', {
            type: 'ok',
            text: `Ваша роль на сервере: ${BASE_ROLE_LABELS[nextRole]}`,
          });
        }
        emitChannels(serverId);
        emitGroups(serverId);
        voice.onPermissionsChanged(serverId);
        emitServers(targetId);
        await enforceChannelAccess();
      }
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:setLabel',
    safe(async ({ userId: targetId, label }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const onlineTarget = sessions
        .sessionsOf(targetId)
        .find((item) => item.serverId === serverId);
      const membership = store.membership(serverId, targetId);
      if (!onlineTarget && !membership) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      const text =
        typeof label === 'string'
          ? label.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH)
          : '';
      if (membership) store.setLabel(serverId, targetId, text);
      if (onlineTarget) {
        sessions.updateAccountInServer(targetId, serverId, { label: text || undefined }, false);
      }
      sessions.broadcastUsers();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:setUserRoles',
    safe(async ({ userId: targetId, roleIds }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || !hasPermission(me, rolesOf(me.serverId), 'roles')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const target = store.userById(targetId);
      if (!target || !store.membership(serverId, targetId)) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      const requested = Array.isArray(roleIds)
        ? roleIds.filter((roleId: unknown): roleId is string => typeof roleId === 'string')
        : [];
      const updated = store.setUserRoles(serverId, targetId, requested);
      if (!updated) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      if (sessions.hasAccount(targetId)) {
        sessions.updateAccountInServer(targetId, serverId, { roleIds: updated.roleIds }, false);
      }
      sessions.broadcastUsers();
      emitChannels(serverId);
      emitGroups(serverId);
      voice.onPermissionsChanged(serverId);
      emitServers(targetId);
      await enforceChannelAccess();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:authorizeGuest',
    safe(async ({ userId: targetId }, ack) => {
      const me = sessions.get(sessionId);
      if (!me?.serverId || (me.role !== 'admin' && me.role !== 'moderator')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const serverId = me.serverId;
      const target = sessions
        .sessionsOf(targetId)
        .find((item) => item.serverId === serverId && item.isGuest);
      if (!target) {
        ack?.({ ok: false, error: 'Гость не найден в сети' });
        return;
      }
      try {
        const result = await auth.authorizeGuest({
          id: target.id,
          displayName: target.displayName,
          serverId,
        });
        if (target.label) store.setLabel(serverId, targetId, target.label);
        sessions.updateAccountInServer(
          targetId,
          serverId,
          {
            username: result.username,
            role: result.account.role,
            roleIds: [],
            isGuest: false,
          },
          false,
        );
        for (const [socketId, account] of socketAccounts) {
          if (account.id === targetId && account.isGuest) {
            socketAccounts.set(socketId, result.account);
          }
        }
        const targetSockets = sessions
          .sessionsOf(targetId)
          .filter((item) => item.serverId === serverId)
          .map((item) => sessions.getSocket(item.sessionId));
        for (const targetSocket of targetSockets) {
          targetSocket?.emit('session:token', { token: result.token });
        }
        // После авторизации id аккаунта сохраняется, поэтому состояние то же.
        sessions.broadcastUsers();
        for (const targetSocket of targetSockets) {
          const updated = targetSocket ? sessions.get(targetSocket.id) : null;
          if (targetSocket && updated) targetSocket.emit('state:me', updated);
          targetSocket?.emit('toast', {
            type: 'ok',
            text: 'Вам назначена роль Пользователь — доступны каналы для участников',
          });
        }
        emitChannels(serverId);
        emitGroups(serverId);
        voice.onPermissionsChanged(serverId);
        emitServers(targetId);
        await enforceChannelAccess();
        ack?.({ ok: true, username: result.username, password: result.password });
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось авторизовать гостя',
        });
      }
    }),
  );

  socket.on('disconnect', () => {
    socketAccounts.delete(socket.id);
    voice
      .disconnectSession(sessionId)
      .catch((error) => console.error('[voice] disconnect cleanup failed', error))
      .finally(() => {
        sessions.unregister(sessionId);
      });
  });
});

// ---------- startup ----------

async function bootstrapAdmin(): Promise<void> {
  if (store.users().length > 0) return;
  const username = config.bootstrapAdminLogin.trim();
  const password = config.bootstrapAdminPassword;
  if (!username || !password) return;
  if (password.length < 8) {
    throw new Error('TENANT_ADMIN_PASSWORD должен содержать минимум 8 символов');
  }
  const displayName = (config.bootstrapAdminDisplayName.trim() || username).slice(
    0,
    MAX_DISPLAY_NAME,
  );
  await auth.register({ username, password, displayName });
  console.log(`[server] создан стартовый администратор ${username}`);
}

async function main(): Promise<void> {
  await bootstrapAdmin();
  await voice.start();
  stats.start();

  httpServer.listen(config.port, config.host, () => {
    console.log(`[server] ${config.serverName} ${APP_VERSION} слушает http://${config.host}:${config.port}`);
    console.log(
      `[server] ANNOUNCED_IP=${config.announcedIp}, RTC ${config.rtcMinPort}-${config.rtcMaxPort}, до ${config.maxParticipants} участников`,
    );
    console.log(`[server] первый зарегистрированный аккаунт получает роль администратора, новые — гостя`);
  });
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}: завершение работы`);
  io.close();
  httpServer.close();
  await voice.close().catch(() => undefined);
  stats.stop();
  store.flush();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error('[server] не удалось запуститься', error);
  process.exit(1);
});
