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
import { BASE_ROLES } from '@tsds/shared';

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  label?: string;
  passwordHash: string;
  role: BaseRole;
  roleIds: string[];
  banned: boolean;
  createdAt: number;
}

export interface StoredChannel {
  id: string;
  name: string;
  type: ChannelType;
  guest?: boolean;
  passwordHash?: string;
  visibleRoles: BaseRole[];
  visibleRoleIds: string[];
  createdAt: number;
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
  version: 1;
  guestInviteCode: string;
  guestInviteRequired: boolean;
  users: StoredUser[];
  channels: StoredChannel[];
  broadcastGroups: BroadcastGroup[];
  roles: Role[];
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

function emptyData(guestInviteCode: string, guestInviteRequired: boolean): StoreData {
  return {
    version: 1,
    guestInviteCode,
    guestInviteRequired,
    users: [],
    channels: [],
    broadcastGroups: [],
    roles: [],
    messages: {},
    directMessages: {},
    pushSubscriptions: {},
    fcmTokens: {},
  };
}

function seedChannels(): StoredChannel[] {
  const now = Date.now();
  return [
    { id: crypto.randomUUID(), name: 'Общий', type: 'voice', visibleRoles: [...BASE_ROLES], visibleRoleIds: [], createdAt: now },
    { id: crypto.randomUUID(), name: 'Вторая комната', type: 'voice', visibleRoles: [...BASE_ROLES], visibleRoleIds: [], createdAt: now },
    { id: crypto.randomUUID(), name: 'Общий чат', type: 'text', visibleRoles: [...BASE_ROLES], visibleRoleIds: [], createdAt: now },
  ];
}

export class Store {
  private data: StoreData;
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    dataDir: string,
    private readonly envInviteCode: string,
    private readonly envInviteRequired: boolean,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'store.json');

    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreData;
      } catch (error) {
        throw new Error(`Не удалось прочитать ${this.file}: ${(error as Error).message}`);
      }
    } else {
      this.data = emptyData(crypto.randomBytes(4).toString('hex'), envInviteRequired);
      this.saveNow();
    }

    if (!Array.isArray(this.data.channels) || this.data.channels.length === 0) {
      this.data.channels = seedChannels();
    }
    this.ensureGuestChannel();
    for (const channel of this.data.channels) {
      if (!Array.isArray(channel.visibleRoles)) {
        channel.visibleRoles = channel.guest
          ? [...BASE_ROLES]
          : ['member', 'moderator', 'admin'];
      }
      channel.visibleRoleIds ??= [];
    }
    this.data.users ??= [];
    this.data.broadcastGroups ??= [];
    this.data.roles ??= [];
    this.data.messages ??= {};
    this.data.directMessages ??= {};
    this.data.pushSubscriptions ??= {};
    this.data.fcmTokens ??= {};
    if (typeof this.data.guestInviteRequired !== 'boolean') {
      this.data.guestInviteRequired = envInviteRequired;
    }
    for (const user of this.data.users) {
      user.roleIds ??= [];
    }
    if (!this.data.guestInviteCode) {
      this.data.guestInviteCode = crypto.randomBytes(4).toString('hex');
    }
    this.saveNow();
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
    this.data.guestInviteCode = crypto.randomBytes(4).toString('hex');
    this.saveNow();
    return this.inviteCode;
  }

  private ensureGuestChannel(): void {
    const guest = this.data.channels.find((channel) => channel.guest);
    if (guest) {
      delete guest.passwordHash;
      guest.visibleRoles = [...BASE_ROLES];
      guest.visibleRoleIds = [];
      return;
    }
    const existing = this.data.channels.find(
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

  // --- users ---

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
      role: this.data.users.length === 0 ? 'admin' : 'guest',
      roleIds: [],
      banned: false,
      createdAt: Date.now(),
    };
    this.data.users.push(user);
    this.saveNow();
    return user;
  }

  createAuthorizedUser(input: {
    id: string;
    username: string;
    displayName: string;
    passwordHash: string;
  }): StoredUser {
    const user: StoredUser = {
      id: input.id,
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: 'member',
      roleIds: [],
      banned: false,
      createdAt: Date.now(),
    };
    this.data.users.push(user);
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

  setRole(id: string, role: BaseRole): StoredUser | undefined {
    const user = this.userById(id);
    if (!user) return undefined;
    user.role = role;
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

  setLabel(id: string, label: string): StoredUser | undefined {
    const user = this.userById(id);
    if (!user) return undefined;
    const trimmed = label.trim();
    if (trimmed) user.label = trimmed;
    else delete user.label;
    this.saveNow();
    return user;
  }

  deleteUser(id: string): boolean {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((u) => u.id !== id);
    if (this.data.users.length === before) return false;
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

  countAdmins(): number {
    return this.data.users.filter((u) => u.role === 'admin' && !u.banned).length;
  }

  adminUsers(): AdminUser[] {
    return this.data.users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      label: u.label,
      role: u.role,
      roleIds: [...u.roleIds],
      isGuest: false,
      banned: u.banned,
      createdAt: u.createdAt,
    }));
  }

  setUserRoles(id: string, roleIds: string[]): StoredUser | undefined {
    const user = this.userById(id);
    if (!user) return undefined;
    const known = new Set(this.data.roles.map((role) => role.id));
    user.roleIds = [...new Set(roleIds)].filter((roleId) => known.has(roleId));
    this.saveNow();
    return user;
  }

  // --- roles ---

  roles(): Role[] {
    return this.data.roles;
  }

  roleById(id: string): Role | undefined {
    return this.data.roles.find((role) => role.id === id);
  }

  roleByName(name: string, exceptId?: string): Role | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.roles.find(
      (role) => role.id !== exceptId && role.name.toLowerCase() === normalized,
    );
  }

  createRole(input: {
    name: string;
    color: string;
    permissions: RolePermissions;
  }): Role {
    const role: Role = {
      id: crypto.randomUUID(),
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
  ): Role | undefined {
    const role = this.roleById(id);
    if (!role) return undefined;
    if (patch.name !== undefined) role.name = patch.name.trim();
    if (patch.color !== undefined) role.color = patch.color;
    if (patch.permissions !== undefined) role.permissions = { ...patch.permissions };
    this.saveNow();
    return role;
  }

  deleteRole(id: string): string[] {
    const before = this.data.roles.length;
    this.data.roles = this.data.roles.filter((role) => role.id !== id);
    if (this.data.roles.length === before) return [];
    const affected: string[] = [];
    for (const user of this.data.users) {
      if (!user.roleIds.includes(id)) continue;
      user.roleIds = user.roleIds.filter((roleId) => roleId !== id);
      affected.push(user.id);
    }
    for (const channel of this.data.channels) {
      if (!channel.visibleRoleIds.includes(id)) continue;
      channel.visibleRoleIds = channel.visibleRoleIds.filter((roleId) => roleId !== id);
    }
    this.saveNow();
    return affected;
  }

  // --- channels ---

  private channelDto(channel: StoredChannel): Channel {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      guest: channel.guest,
      passwordProtected: Boolean(channel.passwordHash),
      visibleRoles: [...channel.visibleRoles],
      visibleRoleIds: [...channel.visibleRoleIds],
      createdAt: channel.createdAt,
    };
  }

  channels(): Channel[] {
    return this.data.channels.map((channel) => this.channelDto(channel));
  }

  channelById(id: string): StoredChannel | undefined {
    return this.data.channels.find((c) => c.id === id);
  }

  channelByName(name: string, exceptId?: string): StoredChannel | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.channels.find(
      (c) => c.id !== exceptId && c.name.toLowerCase() === normalized,
    );
  }

  createChannel(
    name: string,
    type: ChannelType,
    passwordHash?: string,
    visibility?: { visibleRoles?: BaseRole[]; visibleRoleIds?: string[] },
  ): StoredChannel {
    const channel: StoredChannel = {
      id: crypto.randomUUID(),
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

  // --- broadcast groups ---

  broadcastGroups(): BroadcastGroup[] {
    return this.data.broadcastGroups;
  }

  broadcastGroupById(id: string): BroadcastGroup | undefined {
    return this.data.broadcastGroups.find((group) => group.id === id);
  }

  broadcastGroupByName(name: string, exceptId?: string): BroadcastGroup | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.broadcastGroups.find(
      (group) => group.id !== exceptId && group.name.toLowerCase() === normalized,
    );
  }

  createBroadcastGroup(name: string, memberIds: string[]): BroadcastGroup {
    const group: BroadcastGroup = {
      id: crypto.randomUUID(),
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
  ): BroadcastGroup | undefined {
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

  // --- messages ---

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

  // --- direct messages ---

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

  // --- push subscriptions ---

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

  // --- FCM tokens ---

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
