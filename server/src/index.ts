import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  APP_VERSION,
  MAX_CHANNEL_NAME,
  MAX_DISPLAY_NAME,
  MAX_GROUP_NAME,
  MAX_MESSAGE_LENGTH,
  MAX_ROLE_NAME,
  hasAnyPermission,
  hasPermission,
  type Channel,
  type PermissionKey,
  type RolePermissions,
} from '@tsds/shared';
import {
  AuthService,
  hashChannelPassword,
  verifyChannelPassword,
  type Account,
} from './auth.js';
import { config } from './config.js';
import { SessionService } from './session.js';
import { Store } from './store.js';
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

const store = new Store(config.dataDir, config.guestInviteCode, config.guestInviteRequired);
const app = express();
const httpServer = http.createServer(app);
const io: AppServer = new Server(httpServer, {
  maxHttpBufferSize: 1_000_000,
  pingTimeout: 25_000,
});

const sessions = new SessionService(io);
const socketAccounts = new Map<string, Account>();

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

function requirePermission(account: Account, permission: PermissionKey): void {
  if (!hasPermission(account, store.roles(), permission)) {
    throw new HttpError(403, 'Недостаточно прав');
  }
}

function requireAnyPermission(account: Account, permissions: PermissionKey[]): void {
  const roles = store.roles();
  if (!permissions.some((permission) => hasPermission(account, roles, permission))) {
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

const channelNameSchema = z
  .string()
  .trim()
  .min(1, 'Введите название канала')
  .max(MAX_CHANNEL_NAME, `Название: максимум ${MAX_CHANNEL_NAME} символов`);

const channelPasswordSchema = z
  .string()
  .max(64, 'Пароль канала: максимум 64 символа');

const channelSchema = z.object({
  name: channelNameSchema,
  type: z.enum(['voice', 'text']),
  password: channelPasswordSchema.optional(),
});

const channelUpdateSchema = z.object({
  channelId: z.string().min(1),
  name: channelNameSchema,
  password: channelPasswordSchema.optional(),
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

function canSeeGroups(user: { role: Account['role']; roleIds?: string[] }): boolean {
  const roles = store.roles();
  return (
    hasPermission(user, roles, 'groups') || hasPermission(user, roles, 'broadcast')
  );
}

function emitGroups(): void {
  const groups = store.broadcastGroups();
  for (const user of sessions.list()) {
    sessions
      .getSocket(user.id)
      ?.emit('groups:update', canSeeGroups(user) ? groups : []);
  }
}

function channelsFor(role: Account['role']): Channel[] {
  const channels = store.channels();
  return role === 'guest' ? channels.filter((channel) => channel.guest) : channels;
}

function canAccessChannel(
  user: { id: string; role: Account['role'] },
  channel: Channel,
): boolean {
  if (channel.guest) return true;
  if (user.role === 'guest') return false;
  if (user.role === 'admin') return true;
  const stored = store.channelById(channel.id);
  return !stored?.passwordHash || sessions.isChannelUnlocked(user.id, channel.id);
}

function emitChannels(): void {
  const channels = store.channels();
  for (const user of sessions.list()) {
    sessions
      .getSocket(user.id)
      ?.emit(
        'channels:update',
        user.role === 'guest' ? channels.filter((channel) => channel.guest) : channels,
      );
  }
}

function channelSockets(channel: Channel) {
  return sessions
    .list()
    .filter((user) => canAccessChannel(user, channel))
    .map((user) => sessions.getSocket(user.id));
}

function emitRoles(): void {
  io.emit('roles:update', store.roles());
}

function applyRoleLoss(userId: string, roleIds: string[]): void {
  if (sessions.has(userId)) sessions.update(userId, { roleIds });
}

function groupMembers(ids: string[]): string[] {
  const members = [...new Set(ids)].filter((id) => Boolean(store.userById(id)));
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
    guestInviteCode: hasPermission(account, store.roles(), 'invite')
      ? store.inviteCode
      : undefined,
    maxMessageLength: MAX_MESSAGE_LENGTH,
  };
}

function emitConfig(): void {
  io.emit('config:update', publicConfig());
}

// ---------- REST ----------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: config.serverName,
    version: APP_VERSION,
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
    sessions.update(account.id, { displayName: updated.displayName });
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
    const limit = Number.parseInt(String(req.query.limit ?? '100'), 10);
    res.json({ messages: store.messages(channel.id, Number.isFinite(limit) ? limit : 100) });
  }),
);

app.get(
  '/api/admin/users',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requireAnyPermission(account, ['moderate', 'roles', 'groups']);
    res.json({ users: store.adminUsers() });
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
    res.json({ groups: store.broadcastGroups() });
  }),
);

app.post(
  '/api/admin/groups',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    const body = parseBody(broadcastGroupSchema, req.body);
    if (store.broadcastGroupByName(body.name)) {
      throw new HttpError(409, 'Группа с таким названием уже существует');
    }
    const group = store.createBroadcastGroup(body.name, groupMembers(body.memberIds));
    emitGroups();
    res.json({ group });
  }),
);

app.put(
  '/api/admin/groups/:groupId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    const existing = store.broadcastGroupById(req.params.groupId);
    if (!existing) throw new HttpError(404, 'Группа не найдена');
    const body = parseBody(broadcastGroupSchema, req.body);
    if (store.broadcastGroupByName(body.name, existing.id)) {
      throw new HttpError(409, 'Группа с таким названием уже существует');
    }
    const group = store.updateBroadcastGroup(existing.id, {
      name: body.name,
      memberIds: groupMembers(body.memberIds),
    });
    emitGroups();
    voice.onBroadcastGroupsChanged();
    res.json({ group });
  }),
);

app.delete(
  '/api/admin/groups/:groupId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'groups');
    if (!store.deleteBroadcastGroup(req.params.groupId)) {
      throw new HttpError(404, 'Группа не найдена');
    }
    emitGroups();
    voice.onBroadcastGroupsChanged();
    res.json({ ok: true });
  }),
);

// ---------- roles ----------

app.get(
  '/api/admin/roles',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    res.json({ roles: store.roles() });
  }),
);

app.post(
  '/api/admin/roles',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    const body = parseBody(roleSchema, req.body);
    if (store.roleByName(body.name)) {
      throw new HttpError(409, 'Роль с таким названием уже существует');
    }
    const role = store.createRole({
      name: body.name,
      color: body.color,
      permissions: body.permissions as RolePermissions,
    });
    emitRoles();
    res.json({ role });
  }),
);

app.put(
  '/api/admin/roles/:roleId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    const existing = store.roleById(req.params.roleId);
    if (!existing) throw new HttpError(404, 'Роль не найдена');
    const body = parseBody(roleSchema, req.body);
    if (store.roleByName(body.name, existing.id)) {
      throw new HttpError(409, 'Роль с таким названием уже существует');
    }
    const role = store.updateRole(existing.id, {
      name: body.name,
      color: body.color,
      permissions: body.permissions as RolePermissions,
    });
    emitRoles();
    emitGroups();
    voice.onPermissionsChanged();
    res.json({ role });
  }),
);

app.delete(
  '/api/admin/roles/:roleId',
  wrap((req, res) => {
    const account = accountFromRequest(req);
    requirePermission(account, 'roles');
    const existing = store.roleById(req.params.roleId);
    if (!existing) throw new HttpError(404, 'Роль не найдена');
    const affected = store.deleteRole(existing.id);
    for (const userId of affected) {
      const user = store.userById(userId);
      if (user) applyRoleLoss(userId, user.roleIds);
    }
    sessions.broadcastUsers();
    emitRoles();
    emitGroups();
    voice.onPermissionsChanged();
    res.json({ ok: true });
  }),
);

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
    res.type('text/plain').send('YHSpeak: веб-клиент ещё не собран. Выполните npm run build.');
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

  const previous = sessions.getSocket(userId);
  if (previous && previous.id !== socket.id) {
    await voice.disconnectUser(userId);
    previous.emit('session:ended', { reason: 'Вы вошли с другого устройства' });
    previous.disconnect(true);
    sessions.unregister(userId, previous.id);
  }

  const online = sessions.register(socket, account);
  socket.emit('state:init', {
    me: online,
    users: sessions.list(),
    channels: channelsFor(account.role),
    broadcastGroups: canSeeGroups(account) ? store.broadcastGroups() : [],
    roles: store.roles(),
    routerRtpCapabilities: voice.rtpCapabilities(),
    config: clientConfigFor(account),
  });

  const chatTimestamps: number[] = [];

  const safe = (handler: (...args: any[]) => Promise<void>) => {
    return (...args: any[]) => {
      handler(...args).catch((error) => {
        console.error('[socket] handler error', error);
        socket.emit('toast', { type: 'error', text: 'Внутренняя ошибка сервера' });
      });
    };
  };

  socket.on(
    'voice:join',
    safe(async ({ channelId }, ack) => {
      const result = await voice.join(socket, userId, channelId);
      if (!result.ok && result.error) socket.emit('voice:joinFailed', { message: result.error });
      ack?.(result);
    }),
  );

  socket.on(
    'voice:leave',
    safe(async () => {
      await voice.leave(userId);
    }),
  );

  socket.on(
    'voice:connectTransport',
    safe(async ({ direction, dtlsParameters }, ack) => {
      const result = await voice.connectTransport(userId, direction, dtlsParameters);
      ack?.(result);
    }),
  );

  socket.on(
    'voice:ready',
    safe(async ({ rtpCapabilities }, ack) => {
      const result = await voice.ready(userId, rtpCapabilities);
      ack?.(result);
    }),
  );

  socket.on(
    'voice:produce',
    safe(async ({ kind, rtpParameters, source }, ack) => {
      const result = await voice.produce(userId, kind, rtpParameters, source);
      ack(result);
    }),
  );

  socket.on(
    'voice:closeProducer',
    safe(async ({ producerId }) => {
      await voice.closeProducer(userId, producerId);
    }),
  );

  socket.on('voice:setMuted', ({ muted }) => {
    if (!sessions.has(userId)) return;
    sessions.update(userId, { muted: Boolean(muted) });
  });

  socket.on('voice:setDeafened', ({ deafened }) => {
    if (!sessions.has(userId)) return;
    sessions.update(userId, { deafened: Boolean(deafened) });
  });

  socket.on(
    'voice:setBroadcast',
    safe(async (payload, ack) => {
      const all = Boolean(payload?.all);
      const groupIds = Array.isArray(payload?.groupIds)
        ? payload.groupIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const result = await voice.setBroadcast(userId, { all, groupIds });
      if (!result.ok && result.error) socket.emit('toast', { type: 'error', text: result.error });
      ack?.(result);
    }),
  );

  socket.on('chat:send', (payload, ack) => {
    try {
      const me = sessions.get(userId);
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

  socket.on(
    'admin:deleteMessage',
    safe(async ({ channelId, messageId }) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'moderate')) return;
      if (store.deleteMessage(channelId, messageId)) {
        const channel = store.channelById(channelId);
        if (!channel) return;
        for (const target of channelSockets(channel)) {
          target?.emit('chat:deleted', { channelId, messageId });
        }
      }
    }),
  );

  socket.on(
    'channel:unlock',
    safe(async (payload, ack) => {
      const me = sessions.get(userId);
      if (!me) {
        ack?.({ ok: false, error: 'Сессия не найдена' });
        return;
      }
      const body = parseBody(unlockSchema, payload);
      const channel = store.channelById(body.channelId);
      if (!channel) {
        ack?.({ ok: false, error: 'Канал не найден' });
        return;
      }
      if (me.role === 'guest' && !channel.guest) {
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
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'channels')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const body = parseBody(channelSchema, payload);
      if (store.channelByName(body.name)) {
        ack?.({ ok: false, error: 'Канал с таким названием уже существует' });
        return;
      }
      const password = body.password?.trim() ?? '';
      const passwordHash = password ? await hashChannelPassword(password) : undefined;
      store.createChannel(body.name, body.type, passwordHash);
      emitChannels();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'admin:updateChannel',
    safe(async (payload, ack) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'channels')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const body = parseBody(channelUpdateSchema, payload);
      const channel = store.channelById(body.channelId);
      if (!channel) {
        ack?.({ ok: false, error: 'Канал не найден' });
        return;
      }
      if (store.channelByName(body.name, channel.id)) {
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
      store.updateChannel(channel.id, { name: body.name, passwordHash });
      if (typeof passwordHash === 'string') {
        for (const user of sessions.list()) {
          if (user.channelId !== channel.id) continue;
          if (user.role === 'admin' || sessions.isChannelUnlocked(user.id, channel.id)) continue;
          await voice.kick(user.id, 'система');
          sessions.getSocket(user.id)?.emit('toast', {
            type: 'info',
            text: `Канал «${channel.name}» защищён паролем`,
          });
        }
      }
      emitChannels();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'admin:deleteChannel',
    safe(async ({ channelId }, ack) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'channels')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const channel = store.channelById(channelId);
      if (!channel) {
        ack?.({ ok: false, error: 'Канал не найден' });
        return;
      }
      if (channel.guest) {
        ack?.({ ok: false, error: 'Гостевой канал создаётся автоматически и не удаляется' });
        return;
      }
      for (const user of sessions.list()) {
        if (user.channelId === channelId) {
          await voice.kick(user.id, 'система');
          sessions.getSocket(user.id)?.emit('toast', {
            type: 'info',
            text: `Канал «${channel.name}» удалён`,
          });
        }
      }
      store.deleteChannel(channelId);
      sessions.clearChannelUnlocks(channelId);
      emitChannels();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:serverMute',
    safe(async ({ userId: targetId, muted }, ack) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      if (!sessions.has(targetId)) {
        ack?.({ ok: false, error: 'Пользователь не в сети' });
        return;
      }
      await voice.applyServerMute(targetId, Boolean(muted));
      sessions.getSocket(targetId)?.emit('toast', {
        type: muted ? 'info' : 'ok',
        text: muted ? 'Администратор отключил ваш микрофон' : 'Администратор вернул вам микрофон',
      });
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:kick',
    safe(async ({ userId: targetId }, ack) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Нельзя выгнать самого себя' });
        return;
      }
      const target = sessions.get(targetId);
      if (!target?.channelId) {
        ack?.({ ok: false, error: 'Пользователь не в голосовом канале' });
        return;
      }
      await voice.kick(targetId, me.displayName);
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:ban',
    safe(async ({ userId: targetId, banned }, ack) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'moderate')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
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
      if (target.role === 'admin') {
        ack?.({ ok: false, error: 'Нельзя блокировать администратора' });
        return;
      }
      store.setBanned(targetId, Boolean(banned));
      if (banned) {
        sessions.endSession(targetId, 'Вы заблокированы администратором');
      }
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:setRole',
    safe(async ({ userId: targetId, role }, ack) => {
      const me = sessions.get(userId);
      if (!me || me.role !== 'admin') {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      if (targetId === userId) {
        ack?.({ ok: false, error: 'Нельзя изменить свою роль' });
        return;
      }
      const target = store.userById(targetId);
      if (!target) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      store.setRole(targetId, role === 'admin' ? 'admin' : 'member');
      if (sessions.has(targetId)) sessions.update(targetId, { role });
      else sessions.broadcastUsers();
      emitGroups();
      voice.onPermissionsChanged();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:setUserRoles',
    safe(async ({ userId: targetId, roleIds }, ack) => {
      const me = sessions.get(userId);
      if (!me || !hasPermission(me, store.roles(), 'roles')) {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const target = store.userById(targetId);
      if (!target) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      const requested = Array.isArray(roleIds)
        ? roleIds.filter((roleId: unknown): roleId is string => typeof roleId === 'string')
        : [];
      const updated = store.setUserRoles(targetId, requested);
      if (!updated) {
        ack?.({ ok: false, error: 'Пользователь не найден' });
        return;
      }
      if (sessions.has(targetId)) sessions.update(targetId, { roleIds: updated.roleIds });
      else sessions.broadcastUsers();
      emitGroups();
      voice.onPermissionsChanged();
      ack?.({ ok: true });
    }),
  );

  socket.on(
    'mod:authorizeGuest',
    safe(async ({ userId: targetId }, ack) => {
      const me = sessions.get(userId);
      if (!me || me.role !== 'admin') {
        ack?.({ ok: false, error: 'Недостаточно прав' });
        return;
      }
      const target = sessions.get(targetId);
      if (!target || !target.isGuest) {
        ack?.({ ok: false, error: 'Гость не найден в сети' });
        return;
      }
      try {
        const result = await auth.authorizeGuest({
          id: target.id,
          displayName: target.displayName,
        });
        sessions.update(targetId, {
          username: result.username,
          role: result.account.role,
          roleIds: [],
          isGuest: false,
        });
        for (const [socketId, account] of socketAccounts) {
          if (account.id === targetId) socketAccounts.set(socketId, result.account);
        }
        sessions.getSocket(targetId)?.emit('session:token', { token: result.token });
        sessions.getSocket(targetId)?.emit('toast', {
          type: 'ok',
          text: 'Администратор авторизовал вас — доступны каналы для участников',
        });
        emitChannels();
        emitGroups();
        voice.onPermissionsChanged();
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
    const current = sessions.getSocket(userId);
    if (current?.id !== socket.id) return;
    voice
      .disconnectUser(userId)
      .catch((error) => console.error('[voice] disconnect cleanup failed', error))
      .finally(() => {
        sessions.unregister(userId, socket.id);
      });
  });
});

// ---------- startup ----------

async function bootstrapAdmin(): Promise<void> {
  if (store.adminUsers().length > 0) return;
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

  httpServer.listen(config.port, config.host, () => {
    console.log(`[server] ${config.serverName} ${APP_VERSION} слушает http://${config.host}:${config.port}`);
    console.log(
      `[server] ANNOUNCED_IP=${config.announcedIp}, RTC ${config.rtcMinPort}-${config.rtcMaxPort}, до ${config.maxParticipants} участников`,
    );
    console.log(`[server] первый зарегистрированный аккаунт получает роль администратора`);
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
  store.flush();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error('[server] не удалось запуститься', error);
  process.exit(1);
});
