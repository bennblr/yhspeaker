import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AdminUser,
  BaseRole,
  BroadcastGroup,
  Channel,
  ChannelType,
  ChatMessage,
  DirectMessage,
  DmConversation,
  Role,
  RolePermissions,
} from '@tsds/shared';
import { BASE_ROLES, NO_PERMISSIONS } from '@tsds/shared';

// Аккаунт общий для всего сервиса: один логин и пароль, а серверы — это
// пространства внутри него, как в Discord. Роль, метка и набор ролей живут
// в членстве конкретного сервера.
export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  banned: boolean;
  createdAt: number;
  // Сервер, который аккаунт открывал последним: его показываем при входе.
  lastServerId?: string;
}

export interface StoredServer {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: number;
}

export interface StoredMembership {
  serverId: string;
  userId: string;
  role: BaseRole;
  roleIds: string[];
  label?: string;
  joinedAt: number;
}

export interface StoredChannel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  guest?: boolean;
  passwordHash?: string;
  visibleRoles: BaseRole[];
  visibleRoleIds: string[];
  createdAt: number;
}

export interface StoredRole extends Role {
  serverId: string;
}

export interface StoredBroadcastGroup extends BroadcastGroup {
  serverId: string;
}

// Подписка браузера на Web Push. Endpoint уникален для установленного PWA
// и меняется при переустановке, поэтому храним несколько подписок на аккаунт.
export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  device?: string;
  createdAt: number;
}

// Токен Firebase Cloud Messaging приложения для Android. В отличие от Web Push
// у токена нет endpoint и ключей шифрования — сообщение собирает FCM.
export interface StoredFcmToken {
  token: string;
  device?: string;
  createdAt: number;
}

interface StoreData {
  version: 2;
  guestInviteCode: string;
  guestInviteRequired: boolean;
  servers: StoredServer[];
  // serverId -> userId -> членство.
  memberships: Record<string, Record<string, StoredMembership>>;
  users: StoredUser[];
  channels: StoredChannel[];
  broadcastGroups: StoredBroadcastGroup[];
  roles: StoredRole[];
  messages: Record<string, ChatMessage[]>;
  // Личные сообщения: ключ — пара идентификаторов аккаунтов в стабильном порядке.
  directMessages: Record<string, DirectMessage[]>;
  pushSubscriptions: Record<string, StoredPushSubscription[]>;
  fcmTokens: Record<string, StoredFcmToken[]>;
}

const MESSAGES_PER_CHANNEL = 200;
const MESSAGES_PER_CONVERSATION = 200;

function conversationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function inviteCode(): string {
  return crypto.randomBytes(4).toString('hex');
}

function serverSeedChannels(serverId: string): StoredChannel[] {
  const now = Date.now();
  return [
    { id: crypto.randomUUID(), serverId, name: 'Общий', type: 'voice', visibleRoles: [...BASE_ROLES], visibleRoleIds: [], createdAt: now },
    { id: crypto.randomUUID(), serverId, name: 'Общий чат', type: 'text', visibleRoles: [...BASE_ROLES], visibleRoleIds: [], createdAt: now },
  ];
}

function makeServer(name: string, ownerId: string): StoredServer {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40) || 'Новый сервер',
    ownerId,
    inviteCode: inviteCode(),
    createdAt: Date.now(),
  };
}

export class Store {
  private data: StoreData;
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    dataDir: string,
    private readonly envInviteCode: string,
    private readonly envInviteRequired: boolean,
    private readonly defaultServerName: string,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'store.json');

    if (fs.existsSync(this.file)) {
      try {
        this.data = this.read(JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown);
      } catch (error) {
        throw new Error(`Не удалось прочитать ${this.file}: ${(error as Error).message}`);
      }
    } else {
      this.data = this.freshData();
      this.saveNow();
    }

    this.normalize();
    this.saveNow();
  }

  // ---------- загрузка и миграция ----------

  private freshData(): StoreData {
    const server = makeServer(this.defaultServerName, '');
    return {
      version: 2,
      guestInviteCode: inviteCode(),
      guestInviteRequired: this.envInviteRequired,
      servers: [server],
      memberships: { [server.id]: {} },
      users: [],
      channels: serverSeedChannels(server.id),
      broadcastGroups: [],
      roles: [],
      messages: {},
      directMessages: {},
      pushSubscriptions: {},
      fcmTokens: {},
    };
  }

  private read(raw: unknown): StoreData {
    const record = (raw ?? {}) as Record<string, unknown>;
    if (record.version === 2 && Array.isArray(record.servers)) {
      return record as unknown as StoreData;
    }
    return this.migrateLegacy(record);
  }

  // Старое хранилище было одним сервером: оборачиваем его данные в первый
  // сервер, а роли и метки участников переносим в членство.
  private migrateLegacy(raw: Record<string, unknown>): StoreData {
    const legacyUsers = Array.isArray(raw.users) ? (raw.users as Record<string, unknown>[]) : [];
    const legacyChannels = Array.isArray(raw.channels)
      ? (raw.channels as Record<string, unknown>[])
      : [];
    const legacyRoles = Array.isArray(raw.roles) ? (raw.roles as Record<string, unknown>[]) : [];
    const legacyGroups = Array.isArray(raw.broadcastGroups)
      ? (raw.broadcastGroups as Record<string, unknown>[])
      : [];

    const owner =
      legacyUsers.find((user) => user.role === 'admin')?.id ?? legacyUsers[0]?.id ?? '';
    const server = makeServer(this.defaultServerName, String(owner));
    const memberships: Record<string, StoredMembership> = {};
    const users: StoredUser[] = legacyUsers.map((user) => {
      const id = String(user.id);
      const joinedAt = Number(user.createdAt) || Date.now();
      memberships[id] = {
        serverId: server.id,
        userId: id,
        role: (user.role as BaseRole) ?? 'guest',
        roleIds: Array.isArray(user.roleIds) ? (user.roleIds as string[]) : [],
        joinedAt,
      };
      if (typeof user.label === 'string' && user.label.trim()) {
        memberships[id].label = user.label.trim();
      }
      return {
        id,
        username: String(user.username ?? ''),
        displayName: String(user.displayName ?? user.username ?? ''),
        passwordHash: String(user.passwordHash ?? ''),
        banned: Boolean(user.banned),
        createdAt: joinedAt,
      };
    });

    const channels: StoredChannel[] = legacyChannels.map((channel) => ({
      ...(channel as unknown as StoredChannel),
      serverId: server.id,
      visibleRoles: Array.isArray(channel.visibleRoles)
        ? (channel.visibleRoles as BaseRole[])
        : [...BASE_ROLES],
      visibleRoleIds: Array.isArray(channel.visibleRoleIds)
        ? (channel.visibleRoleIds as string[])
        : [],
    }));

    return {
      version: 2,
      guestInviteCode:
        typeof raw.guestInviteCode === 'string' && raw.guestInviteCode
          ? raw.guestInviteCode
          : inviteCode(),
      guestInviteRequired:
        typeof raw.guestInviteRequired === 'boolean'
          ? raw.guestInviteRequired
          : this.envInviteRequired,
      servers: [server],
      memberships: { [server.id]: memberships },
      users,
      channels: channels.length ? channels : serverSeedChannels(server.id),
      broadcastGroups: legacyGroups.map((group) => ({
        ...(group as unknown as BroadcastGroup),
        serverId: server.id,
      })),
      roles: legacyRoles.map((role) => ({
        ...(role as unknown as Role),
        serverId: server.id,
      })),
      messages: (raw.messages as Record<string, ChatMessage[]>) ?? {},
      directMessages: (raw.directMessages as Record<string, DirectMessage[]>) ?? {},
      pushSubscriptions: (raw.pushSubscriptions as Record<string, StoredPushSubscription[]>) ?? {},
      fcmTokens: (raw.fcmTokens as Record<string, StoredFcmToken[]>) ?? {},
    };
  }

  private normalize(): void {
    this.data.servers ??= [];
    this.data.users ??= [];
    this.data.channels ??= [];
    this.data.broadcastGroups ??= [];
    this.data.roles ??= [];
    this.data.messages ??= {};
    this.data.directMessages ??= {};
    this.data.pushSubscriptions ??= {};
    this.data.fcmTokens ??= {};
    this.data.memberships ??= {};
    if (typeof this.data.guestInviteRequired !== 'boolean') {
      this.data.guestInviteRequired = this.envInviteRequired;
    }
    if (!this.data.guestInviteCode) this.data.guestInviteCode = inviteCode();

    if (this.data.servers.length === 0) {
      const server = makeServer(this.defaultServerName, '');
      this.data.servers.push(server);
      this.data.memberships[server.id] = {};
      this.data.channels.push(...serverSeedChannels(server.id));
    }
    const fallbackServerId = this.data.servers[0].id;

    for (const server of this.data.servers) {
      server.name = server.name?.trim() || this.defaultServerName;
      if (!server.inviteCode) server.inviteCode = inviteCode();
      this.data.memberships[server.id] ??= {};
      for (const [userId, membership] of Object.entries(this.data.memberships[server.id])) {
        membership.serverId ??= server.id;
        membership.userId ??= userId;
        membership.roleIds ??= [];
      }
    }

    for (const user of this.data.users) {
      if (user.lastServerId && !this.serverById(user.lastServerId)) delete user.lastServerId;
    }

    for (const channel of this.data.channels) {
      channel.serverId ??= fallbackServerId;
      if (!Array.isArray(channel.visibleRoles)) {
        channel.visibleRoles = channel.guest
          ? [...BASE_ROLES]
          : ['member', 'moderator', 'admin'];
      }
      channel.visibleRoleIds ??= [];
    }
    for (const role of this.data.roles) {
      role.serverId ??= fallbackServerId;
      role.permissions = { ...NO_PERMISSIONS, ...(role.permissions ?? {}) };
    }
    for (const group of this.data.broadcastGroups) group.serverId ??= fallbackServerId;

    this.ensureGuestChannel(fallbackServerId);
  }

  get inviteCode(): string {
    return this.envInviteCode || this.data.guestInviteCode;
  }

  get guestInviteRequired(): boolean {
    return this.data.guestInviteRequired;
  }

  setGuestInviteRequired(value: boolean): boolean {
    this.data.guestInviteRequired = value;
    this.saveNow();
    return value;
  }

  regenerateInviteCode(): string {
    this.data.guestInviteCode = inviteCode();
    this.saveNow();
    return this.inviteCode;
  }

  // Гостевой канал нужен только на основном сервере: гости попадают туда
  // и не выбирают серверы.
  private ensureGuestChannel(serverId: string): void {
    const channels = this.data.channels.filter((channel) => channel.serverId === serverId);
    const guest = channels.find((channel) => channel.guest);
    if (guest) {
      delete guest.passwordHash;
      guest.visibleRoles = [...BASE_ROLES];
      guest.visibleRoleIds = [];
      return;
    }
    const existing = channels.find(
      (channel) => channel.type === 'voice' && channel.name.trim().toLowerCase() === 'гостевая',
    );
    if (existing) {
      existing.guest = true;
      delete existing.passwordHash;
      existing.visibleRoles = [...BASE_ROLES];
      existing.visibleRoleIds = [];
      return;
    }
    this.data.channels.unshift({
      id: crypto.randomUUID(),
      serverId,
      name: 'Гостевая',
      type: 'voice',
      guest: true,
      visibleRoles: [...BASE_ROLES],
      visibleRoleIds: [],
      createdAt: Date.now(),
    });
  }

  private saveNow(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 300);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  // ---------- серверы ----------

  servers(): StoredServer[] {
    return this.data.servers;
  }

  serverById(id: string | null | undefined): StoredServer | undefined {
    if (!id) return undefined;
    return this.data.servers.find((server) => server.id === id);
  }

  defaultServerId(): string {
    return this.data.servers[0].id;
  }

  serverByInviteCode(code: string): StoredServer | undefined {
    const normalized = code.trim().toLowerCase();
    if (!normalized) return undefined;
    return this.data.servers.find((server) => server.inviteCode.toLowerCase() === normalized);
  }

  createServer(name: string, ownerId: string): StoredServer {
    const server = makeServer(name, ownerId);
    this.data.servers.push(server);
    this.data.memberships[server.id] = {};
    if (ownerId) {
      this.addMembership(server.id, ownerId, 'admin');
      const user = this.userById(ownerId);
      if (user) user.lastServerId = server.id;
    }
    this.data.channels.push(...serverSeedChannels(server.id));
    this.saveNow();
    return server;
  }

  regenerateServerInvite(serverId: string): string | undefined {
    const server = this.serverById(serverId);
    if (!server) return undefined;
    server.inviteCode = inviteCode();
    this.saveNow();
    return server.inviteCode;
  }

  deleteServer(serverId: string): boolean {
    if (serverId === this.defaultServerId()) return false;
    if (!this.serverById(serverId)) return false;
    this.data.servers = this.data.servers.filter((server) => server.id !== serverId);
    delete this.data.memberships[serverId];
    const channelIds = new Set(
      this.data.channels.filter((channel) => channel.serverId === serverId).map((channel) => channel.id),
    );
    this.data.channels = this.data.channels.filter((channel) => channel.serverId !== serverId);
    this.data.roles = this.data.roles.filter((role) => role.serverId !== serverId);
    this.data.broadcastGroups = this.data.broadcastGroups.filter(
      (group) => group.serverId !== serverId,
    );
    for (const channelId of channelIds) delete this.data.messages[channelId];
    for (const user of this.data.users) {
      if (user.lastServerId === serverId) delete user.lastServerId;
    }
    this.saveNow();
    return true;
  }

  // ---------- членство и аккаунты ----------

  membership(serverId: string | null | undefined, userId: string): StoredMembership | undefined {
    if (!serverId) return undefined;
    return this.data.memberships[serverId]?.[userId];
  }

  membershipsOf(userId: string): StoredMembership[] {
    const result: StoredMembership[] = [];
    for (const server of this.data.servers) {
      const membership = this.data.memberships[server.id]?.[userId];
      if (membership) result.push(membership);
    }
    return result;
  }

  serversOf(userId: string): StoredServer[] {
    return this.data.servers.filter((server) => Boolean(this.data.memberships[server.id]?.[userId]));
  }

  preferredServerId(userId: string): string | undefined {
    const user = this.userById(userId);
    const last = user?.lastServerId;
    if (last && this.membership(last, userId)) return last;
    return this.serversOf(userId)[0]?.id;
  }

  setLastServer(userId: string, serverId: string): void {
    const user = this.userById(userId);
    if (!user || !this.membership(serverId, userId)) return;
    user.lastServerId = serverId;
    this.saveSoon();
  }

  memberIds(serverId: string): string[] {
    return Object.keys(this.data.memberships[serverId] ?? {});
  }

  serverMembers(serverId: string): StoredUser[] {
    const ids = new Set(this.memberIds(serverId));
    return this.data.users.filter((user) => ids.has(user.id));
  }

  // Аккаунты, с которыми у пользователя есть хотя бы один общий сервер:
  // только им можно писать в личные сообщения.
  sharedServerUserIds(userId: string): Set<string> {
    const result = new Set<string>();
    for (const membership of this.membershipsOf(userId)) {
      for (const id of this.memberIds(membership.serverId)) result.add(id);
    }
    return result;
  }

  private addMembership(serverId: string, userId: string, role: BaseRole): StoredMembership {
    const map = (this.data.memberships[serverId] ??= {});
    const existing = map[userId];
    if (existing) return existing;
    const membership: StoredMembership = {
      serverId,
      userId,
      role,
      roleIds: [],
      joinedAt: Date.now(),
    };
    map[userId] = membership;
    return membership;
  }

  addMember(serverId: string, userId: string, role: BaseRole = 'member'): StoredMembership | undefined {
    if (!this.serverById(serverId) || !this.userById(userId)) return undefined;
    const membership = this.addMembership(serverId, userId, role);
    this.saveNow();
    return membership;
  }

  removeMember(serverId: string, userId: string): boolean {
    const map = this.data.memberships[serverId];
    if (!map?.[userId]) return false;
    delete map[userId];
    const server = this.serverById(serverId);
    if (server?.ownerId === userId) {
      const next = Object.values(map).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        server.ownerId = next.userId;
        next.role = 'admin';
      } else {
        this.deleteServer(serverId);
      }
    }
    for (const group of this.data.broadcastGroups) {
      if (group.serverId !== serverId) continue;
      group.memberIds = group.memberIds.filter((id) => id !== userId);
    }
    const user = this.userById(userId);
    if (user?.lastServerId === serverId) delete user.lastServerId;
    this.saveNow();
    return true;
  }

  users(): StoredUser[] {
    return this.data.users;
  }

  userById(id: string): StoredUser | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  userByUsername(username: string): StoredUser | undefined {
    const normalized = username.trim().toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === normalized);
  }

  isIdentityTaken(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return this.data.users.some(
      (u) =>
        u.username.toLowerCase() === normalized || u.displayName.toLowerCase() === normalized,
    );
  }

  // Регистрация входит на основной сервер: первый аккаунт становится его
  // владельцем, остальные получают роль гостя до подтверждения.
  createUser(input: {
    username: string;
    displayName: string;
    passwordHash: string;
  }): StoredUser {
    const user: StoredUser = {
      id: crypto.randomUUID(),
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      banned: false,
      createdAt: Date.now(),
    };
    this.data.users.push(user);
    const server = this.data.servers[0];
    let role: BaseRole = 'guest';
    if (!server.ownerId) {
      server.ownerId = user.id;
      role = 'admin';
    }
    this.addMembership(server.id, user.id, role);
    user.lastServerId = server.id;
    this.saveNow();
    return user;
  }

  createAuthorizedUser(
    input: {
      id: string;
      username: string;
      displayName: string;
      passwordHash: string;
    },
    serverId: string,
  ): StoredUser {
    const user: StoredUser = {
      id: input.id,
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      banned: false,
      createdAt: Date.now(),
    };
    this.data.users.push(user);
    this.addMembership(serverId, user.id, 'member');
    user.lastServerId = serverId;
    this.saveNow();
    return user;
  }

  setBanned(id: string, banned: boolean): StoredUser | undefined {
    const user = this.userById(id);
    if (!user) return undefined;
    user.banned = banned;
    this.saveNow();
    return user;
  }

  renameUser(id: string, displayName: string): StoredUser | undefined {
    const user = this.userById(id);
    if (!user) return undefined;
    user.displayName = displayName.trim();
    this.saveNow();
    return user;
  }

  deleteUser(id: string): boolean {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((u) => u.id !== id);
    if (this.data.users.length === before) return false;

    for (const server of [...this.data.servers]) {
      const map = this.data.memberships[server.id];
      if (!map?.[id]) continue;
      if (server.ownerId === id) {
        const next = Object.values(map)
          .filter((membership) => membership.userId !== id)
          .sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (next) {
          server.ownerId = next.userId;
          next.role = 'admin';
        } else if (server.id !== this.defaultServerId()) {
          this.deleteServer(server.id);
          continue;
        } else {
          server.ownerId = '';
        }
      }
      delete map[id];
    }

    for (const group of this.data.broadcastGroups) {
      group.memberIds = group.memberIds.filter((memberId) => memberId !== id);
    }
    for (const key of Object.keys(this.data.directMessages ?? {})) {
      const [a, b] = key.split('|');
      if (a === id || b === id) delete this.data.directMessages[key];
    }
    delete this.data.pushSubscriptions[id];
    delete this.data.fcmTokens[id];
    this.saveNow();
    return true;
  }

  countAdmins(serverId: string): number {
    return Object.values(this.data.memberships[serverId] ?? {}).filter(
      (membership) => membership.role === 'admin' && !this.userById(membership.userId)?.banned,
    ).length;
  }

  adminUsers(serverId: string): AdminUser[] {
    const map = this.data.memberships[serverId] ?? {};
    const result: AdminUser[] = [];
    for (const user of this.data.users) {
      const membership = map[user.id];
      if (!membership) continue;
      result.push({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        label: membership.label,
        role: membership.role,
        roleIds: [...membership.roleIds],
        isGuest: false,
        banned: user.banned,
        createdAt: user.createdAt,
      });
    }
    return result;
  }

  setRole(serverId: string, userId: string, role: BaseRole): StoredMembership | undefined {
    const membership = this.membership(serverId, userId);
    if (!membership) return undefined;
    membership.role = role;
    this.saveNow();
    return membership;
  }

  setLabel(serverId: string, userId: string, label: string): StoredMembership | undefined {
    const membership = this.membership(serverId, userId);
    if (!membership) return undefined;
    const trimmed = label.trim();
    if (trimmed) membership.label = trimmed;
    else delete membership.label;
    this.saveNow();
    return membership;
  }

  setUserRoles(
    serverId: string,
    userId: string,
    roleIds: string[],
  ): StoredMembership | undefined {
    const membership = this.membership(serverId, userId);
    if (!membership) return undefined;
    const known = new Set(
      this.data.roles.filter((role) => role.serverId === serverId).map((role) => role.id),
    );
    membership.roleIds = [...new Set(roleIds)].filter((roleId) => known.has(roleId));
    this.saveNow();
    return membership;
  }

  // ---------- роли ----------

  roles(serverId: string): Role[] {
    return this.data.roles.filter((role) => role.serverId === serverId);
  }

  roleById(id: string): StoredRole | undefined {
    return this.data.roles.find((role) => role.id === id);
  }

  roleByName(serverId: string, name: string, exceptId?: string): StoredRole | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.roles.find(
      (role) =>
        role.serverId === serverId &&
        role.id !== exceptId &&
        role.name.toLowerCase() === normalized,
    );
  }

  createRole(
    serverId: string,
    input: { name: string; color: string; permissions: RolePermissions },
  ): StoredRole {
    const role: StoredRole = {
      id: crypto.randomUUID(),
      serverId,
      name: input.name.trim(),
      color: input.color,
      permissions: { ...input.permissions },
      createdAt: Date.now(),
    };
    this.data.roles.push(role);
    this.saveNow();
    return role;
  }

  updateRole(
    id: string,
    patch: { name?: string; color?: string; permissions?: RolePermissions },
  ): StoredRole | undefined {
    const role = this.roleById(id);
    if (!role) return undefined;
    if (patch.name !== undefined) role.name = patch.name.trim();
    if (patch.color !== undefined) role.color = patch.color;
    if (patch.permissions !== undefined) role.permissions = { ...patch.permissions };
    this.saveNow();
    return role;
  }

  // Возвращает участников этого сервера, у которых роль была снята.
  deleteRole(serverId: string, id: string): string[] {
    const before = this.data.roles.length;
    this.data.roles = this.data.roles.filter(
      (role) => !(role.id === id && role.serverId === serverId),
    );
    if (this.data.roles.length === before) return [];
    const affected: string[] = [];
    for (const membership of Object.values(this.data.memberships[serverId] ?? {})) {
      if (!membership.roleIds.includes(id)) continue;
      membership.roleIds = membership.roleIds.filter((roleId) => roleId !== id);
      affected.push(membership.userId);
    }
    for (const channel of this.data.channels) {
      if (channel.serverId !== serverId || !channel.visibleRoleIds.includes(id)) continue;
      channel.visibleRoleIds = channel.visibleRoleIds.filter((roleId) => roleId !== id);
    }
    this.saveNow();
    return affected;
  }

  // ---------- каналы ----------

  private channelDto(channel: StoredChannel): Channel {
    return {
      id: channel.id,
      serverId: channel.serverId,
      name: channel.name,
      type: channel.type,
      guest: channel.guest,
      passwordProtected: Boolean(channel.passwordHash),
      visibleRoles: [...channel.visibleRoles],
      visibleRoleIds: [...channel.visibleRoleIds],
      createdAt: channel.createdAt,
    };
  }

  channels(serverId: string): Channel[] {
    return this.data.channels
      .filter((channel) => channel.serverId === serverId)
      .map((channel) => this.channelDto(channel));
  }

  channelById(id: string): StoredChannel | undefined {
    return this.data.channels.find((c) => c.id === id);
  }

  channelByName(serverId: string, name: string, exceptId?: string): StoredChannel | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.channels.find(
      (c) =>
        c.serverId === serverId &&
        c.id !== exceptId &&
        c.name.toLowerCase() === normalized,
    );
  }

  createChannel(
    serverId: string,
    name: string,
    type: ChannelType,
    passwordHash?: string,
    visibility?: { visibleRoles?: BaseRole[]; visibleRoleIds?: string[] },
  ): StoredChannel {
    const channel: StoredChannel = {
      id: crypto.randomUUID(),
      serverId,
      name: name.trim(),
      type,
      visibleRoles: [...(visibility?.visibleRoles ?? BASE_ROLES)],
      visibleRoleIds: [...(visibility?.visibleRoleIds ?? [])],
      createdAt: Date.now(),
    };
    if (passwordHash) channel.passwordHash = passwordHash;
    this.data.channels.push(channel);
    this.saveNow();
    return channel;
  }

  updateChannel(
    id: string,
    patch: {
      name?: string;
      passwordHash?: string | null;
      visibleRoles?: BaseRole[];
      visibleRoleIds?: string[];
    },
  ): StoredChannel | undefined {
    const channel = this.channelById(id);
    if (!channel) return undefined;
    if (patch.name !== undefined) channel.name = patch.name.trim();
    if (patch.passwordHash === null) delete channel.passwordHash;
    else if (patch.passwordHash !== undefined) channel.passwordHash = patch.passwordHash;
    if (patch.visibleRoles !== undefined) channel.visibleRoles = [...patch.visibleRoles];
    if (patch.visibleRoleIds !== undefined) channel.visibleRoleIds = [...patch.visibleRoleIds];
    this.saveNow();
    return channel;
  }

  deleteChannel(id: string): boolean {
    const target = this.data.channels.find((c) => c.id === id);
    if (target?.guest) return false;
    const before = this.data.channels.length;
    this.data.channels = this.data.channels.filter((c) => c.id !== id);
    delete this.data.messages[id];
    const removed = this.data.channels.length !== before;
    if (removed) this.saveNow();
    return removed;
  }

  // ---------- группы вещания ----------

  broadcastGroups(serverId: string): StoredBroadcastGroup[] {
    return this.data.broadcastGroups.filter((group) => group.serverId === serverId);
  }

  broadcastGroupById(id: string): StoredBroadcastGroup | undefined {
    return this.data.broadcastGroups.find((group) => group.id === id);
  }

  broadcastGroupByName(
    serverId: string,
    name: string,
    exceptId?: string,
  ): StoredBroadcastGroup | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.broadcastGroups.find(
      (group) =>
        group.serverId === serverId &&
        group.id !== exceptId &&
        group.name.toLowerCase() === normalized,
    );
  }

  createBroadcastGroup(
    serverId: string,
    name: string,
    memberIds: string[],
  ): StoredBroadcastGroup {
    const group: StoredBroadcastGroup = {
      id: crypto.randomUUID(),
      serverId,
      name: name.trim(),
      memberIds: [...new Set(memberIds)],
      createdAt: Date.now(),
    };
    this.data.broadcastGroups.push(group);
    this.saveNow();
    return group;
  }

  updateBroadcastGroup(
    id: string,
    patch: { name?: string; memberIds?: string[] },
  ): StoredBroadcastGroup | undefined {
    const group = this.broadcastGroupById(id);
    if (!group) return undefined;
    if (patch.name !== undefined) group.name = patch.name.trim();
    if (patch.memberIds !== undefined) group.memberIds = [...new Set(patch.memberIds)];
    this.saveNow();
    return group;
  }

  deleteBroadcastGroup(id: string): boolean {
    const before = this.data.broadcastGroups.length;
    this.data.broadcastGroups = this.data.broadcastGroups.filter((group) => group.id !== id);
    const removed = this.data.broadcastGroups.length !== before;
    if (removed) this.saveNow();
    return removed;
  }

  // ---------- сообщения ----------

  messages(channelId: string, limit = 100): ChatMessage[] {
    const list = this.data.messages[channelId] ?? [];
    return list.slice(-Math.max(1, Math.min(limit, MESSAGES_PER_CHANNEL)));
  }

  messageCount(channelId: string): number {
    return this.data.messages[channelId]?.length ?? 0;
  }

  addMessage(message: ChatMessage): void {
    const list = (this.data.messages[message.channelId] ??= []);
    list.push(message);
    if (list.length > MESSAGES_PER_CHANNEL) {
      list.splice(0, list.length - MESSAGES_PER_CHANNEL);
    }
    this.saveSoon();
  }

  deleteMessage(channelId: string, messageId: string): boolean {
    const list = this.data.messages[channelId];
    if (!list) return false;
    const index = list.findIndex((m) => m.id === messageId);
    if (index === -1) return false;
    list.splice(index, 1);
    this.saveSoon();
    return true;
  }

  // ---------- личные сообщения ----------

  directMessages(userId: string, peerId: string, limit = 100): DirectMessage[] {
    const list = this.data.directMessages[conversationKey(userId, peerId)] ?? [];
    return list.slice(-Math.max(1, Math.min(limit, MESSAGES_PER_CONVERSATION)));
  }

  addDirectMessage(message: DirectMessage): void {
    const key = conversationKey(message.from.id, message.to.id);
    const list = (this.data.directMessages[key] ??= []);
    list.push(message);
    if (list.length > MESSAGES_PER_CONVERSATION) {
      list.splice(0, list.length - MESSAGES_PER_CONVERSATION);
    }
    this.saveSoon();
  }

  dmConversations(userId: string): DmConversation[] {
    const result: DmConversation[] = [];
    for (const list of Object.values(this.data.directMessages)) {
      const last = list[list.length - 1];
      if (!last) continue;
      if (last.from.id !== userId && last.to.id !== userId) continue;
      result.push({
        peer: last.from.id === userId ? last.to : last.from,
        last,
        count: list.length,
      });
    }
    return result.sort((a, b) => b.last.ts - a.last.ts);
  }

  // ---------- push-подписки ----------

  pushSubscriptions(userId: string): StoredPushSubscription[] {
    return this.data.pushSubscriptions[userId] ?? [];
  }

  savePushSubscription(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string; device?: string },
  ): void {
    // Один и тот же браузер может войти в другой аккаунт. Снимаем endpoint
    // с прежних аккаунтов, иначе уведомления уходили бы не тому.
    for (const [ownerId, list] of Object.entries(this.data.pushSubscriptions)) {
      if (ownerId === userId) continue;
      const next = list.filter((item) => item.endpoint !== input.endpoint);
      if (next.length === list.length) continue;
      if (next.length) this.data.pushSubscriptions[ownerId] = next;
      else delete this.data.pushSubscriptions[ownerId];
    }

    const list = (this.data.pushSubscriptions[userId] ??= []);
    const record: StoredPushSubscription = {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      device: input.device,
      createdAt: Date.now(),
    };
    const index = list.findIndex((item) => item.endpoint === input.endpoint);
    if (index === -1) {
      list.push(record);
      // У одного аккаунта редко больше трёх устройств; старые подписки
      // выбрасываем, чтобы store.json не рос бесконечно.
      if (list.length > 10) list.splice(0, list.length - 10);
    } else {
      list[index] = record;
    }
    this.saveSoon();
  }

  removePushSubscription(userId: string, endpoint: string): void {
    const list = this.data.pushSubscriptions[userId];
    if (!list) return;
    const next = list.filter((item) => item.endpoint !== endpoint);
    if (next.length === list.length) return;
    this.data.pushSubscriptions[userId] = next;
    this.saveSoon();
  }

  // ---------- FCM-токены ----------

  fcmTokens(userId: string): StoredFcmToken[] {
    return this.data.fcmTokens[userId] ?? [];
  }

  saveFcmToken(userId: string, token: string, device?: string): void {
    // Телефон мог войти в другой аккаунт: токен принадлежит установке
    // приложения, поэтому снимаем его с предыдущего владельца.
    for (const [ownerId, list] of Object.entries(this.data.fcmTokens)) {
      if (ownerId === userId) continue;
      const next = list.filter((item) => item.token !== token);
      if (next.length === list.length) continue;
      if (next.length) this.data.fcmTokens[ownerId] = next;
      else delete this.data.fcmTokens[ownerId];
    }

    const list = (this.data.fcmTokens[userId] ??= []);
    const record: StoredFcmToken = { token, device, createdAt: Date.now() };
    const index = list.findIndex((item) => item.token === token);
    if (index === -1) {
      list.push(record);
      if (list.length > 10) list.splice(0, list.length - 10);
    } else {
      list[index] = record;
    }
    this.saveSoon();
  }

  removeFcmToken(userId: string, token: string): void {
    const list = this.data.fcmTokens[userId];
    if (!list) return;
    const next = list.filter((item) => item.token !== token);
    if (next.length === list.length) return;
    if (next.length) this.data.fcmTokens[userId] = next;
    else delete this.data.fcmTokens[userId];
    this.saveSoon();
  }
}
