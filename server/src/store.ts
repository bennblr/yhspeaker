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
  Role,
  RolePermissions,
} from '@tsds/shared';

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: Extract<BaseRole, 'admin' | 'member'>;
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
}

const MESSAGES_PER_CHANNEL = 200;

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
  };
}

function seedChannels(): StoredChannel[] {
  const now = Date.now();
  return [
    { id: crypto.randomUUID(), name: 'Общий', type: 'voice', createdAt: now },
    { id: crypto.randomUUID(), name: 'Вторая комната', type: 'voice', createdAt: now },
    { id: crypto.randomUUID(), name: 'Общий чат', type: 'text', createdAt: now },
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
    this.data.users ??= [];
    this.data.broadcastGroups ??= [];
    this.data.roles ??= [];
    this.data.messages ??= {};
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
      return;
    }
    const existing = this.data.channels.find(
      (channel) => channel.type === 'voice' && channel.name.trim().toLowerCase() === 'гостевая',
    );
    if (existing) {
      existing.guest = true;
      delete existing.passwordHash;
      return;
    }
    this.data.channels.unshift({
      id: crypto.randomUUID(),
      name: 'Гостевая',
      type: 'voice',
      guest: true,
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
      role: this.data.users.length === 0 ? 'admin' : 'member',
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

  setRole(id: string, role: 'admin' | 'member'): StoredUser | undefined {
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

  countAdmins(): number {
    return this.data.users.filter((u) => u.role === 'admin' && !u.banned).length;
  }

  adminUsers(): AdminUser[] {
    return this.data.users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
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

  createChannel(name: string, type: ChannelType, passwordHash?: string): StoredChannel {
    const channel: StoredChannel = {
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
      createdAt: Date.now(),
    };
    if (passwordHash) channel.passwordHash = passwordHash;
    this.data.channels.push(channel);
    this.saveNow();
    return channel;
  }

  updateChannel(
    id: string,
    patch: { name?: string; passwordHash?: string | null },
  ): StoredChannel | undefined {
    const channel = this.channelById(id);
    if (!channel) return undefined;
    if (patch.name !== undefined) channel.name = patch.name.trim();
    if (patch.passwordHash === null) delete channel.passwordHash;
    else if (patch.passwordHash !== undefined) channel.passwordHash = patch.passwordHash;
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
}
