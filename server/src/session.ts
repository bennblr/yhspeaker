import type { DeviceInfo, OnlineUser } from '@tsds/shared';
import type { Account } from './auth.js';
import type { AppServer, AppSocket } from './types.js';

interface SessionEntry {
  socket: AppSocket;
  online: OnlineUser;
}

// Один аккаунт может быть подключён с нескольких устройств: каждая вкладка,
// браузер или копия приложения — отдельная сессия со своим голосовым состоянием.
export class SessionService {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly byAccount = new Map<string, Set<string>>();
  private readonly unlocked = new Map<string, Set<string>>();

  constructor(private readonly io: AppServer) {}

  static onlineFrom(account: Account, sessionId: string, device: DeviceInfo): OnlineUser {
    return {
      id: account.id,
      sessionId,
      device: device.kind,
      deviceName: device.name,
      username: account.username,
      displayName: account.displayName,
      label: account.label,
      role: account.role,
      roleIds: [...account.roleIds],
      isGuest: account.isGuest,
      channelId: null,
      muted: false,
      serverMuted: false,
      deafened: false,
      broadcasting: false,
      broadcastAll: false,
      broadcastGroupIds: [],
      broadcastPriority: false,
      screenSharing: false,
    };
  }

  register(socket: AppSocket, account: Account, device: DeviceInfo): OnlineUser {
    const entry: SessionEntry = {
      socket,
      online: SessionService.onlineFrom(account, socket.id, device),
    };
    this.sessions.set(socket.id, entry);
    let ids = this.byAccount.get(account.id);
    if (!ids) {
      ids = new Set();
      this.byAccount.set(account.id, ids);
    }
    ids.add(socket.id);
    this.broadcastUsers();
    return entry.online;
  }

  unregister(sessionId: string): OnlineUser | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    this.sessions.delete(sessionId);
    const ids = this.byAccount.get(entry.online.id);
    ids?.delete(sessionId);
    if (ids && ids.size === 0) {
      this.byAccount.delete(entry.online.id);
      this.unlocked.delete(entry.online.id);
    }
    this.broadcastUsers();
    return entry.online;
  }

  isChannelUnlocked(userId: string, channelId: string): boolean {
    return this.unlocked.get(userId)?.has(channelId) ?? false;
  }

  unlockChannel(userId: string, channelId: string): void {
    let set = this.unlocked.get(userId);
    if (!set) {
      set = new Set();
      this.unlocked.set(userId, set);
    }
    set.add(channelId);
  }

  clearChannelUnlocks(channelId: string): void {
    for (const set of this.unlocked.values()) set.delete(channelId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  hasAccount(userId: string): boolean {
    return (this.byAccount.get(userId)?.size ?? 0) > 0;
  }

  get(sessionId: string): OnlineUser | undefined {
    return this.sessions.get(sessionId)?.online;
  }

  getSocket(sessionId: string): AppSocket | undefined {
    return this.sessions.get(sessionId)?.socket;
  }

  sessionsOf(userId: string): OnlineUser[] {
    const ids = this.byAccount.get(userId);
    if (!ids) return [];
    const result: OnlineUser[] = [];
    for (const sessionId of ids) {
      const entry = this.sessions.get(sessionId);
      if (entry) result.push(entry.online);
    }
    return result;
  }

  socketsOf(userId: string): AppSocket[] {
    const ids = this.byAccount.get(userId);
    if (!ids) return [];
    const result: AppSocket[] = [];
    for (const sessionId of ids) {
      const entry = this.sessions.get(sessionId);
      if (entry) result.push(entry.socket);
    }
    return result;
  }

  list(): OnlineUser[] {
    return [...this.sessions.values()].map((entry) => entry.online);
  }

  accountCount(): number {
    return this.byAccount.size;
  }

  update(sessionId: string, patch: Partial<OnlineUser>, broadcast = true): OnlineUser | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    Object.assign(entry.online, patch);
    if (broadcast) this.broadcastUsers();
    return entry.online;
  }

  // Изменение свойств аккаунта (роль, ник, мут) применяется ко всем его устройствам.
  updateAccount(
    userId: string,
    patch: Partial<OnlineUser>,
    broadcast = true,
  ): OnlineUser[] {
    const updated: OnlineUser[] = [];
    for (const online of this.sessionsOf(userId)) {
      Object.assign(online, patch);
      updated.push(online);
    }
    if (broadcast && updated.length > 0) this.broadcastUsers();
    return updated;
  }

  broadcastUsers(): void {
    this.io.emit('state:users', this.list());
  }

  endAccount(userId: string, reason: string): void {
    for (const socket of this.socketsOf(userId)) {
      socket.emit('session:ended', { reason });
      socket.disconnect(true);
    }
  }

  endSession(sessionId: string, reason: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.socket.emit('session:ended', { reason });
    entry.socket.disconnect(true);
  }
}
