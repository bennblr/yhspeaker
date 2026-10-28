import type { OnlineUser } from '@tsds/shared';
import type { Account } from './auth.js';
import type { AppServer, AppSocket } from './types.js';

interface SessionEntry {
  socket: AppSocket;
  online: OnlineUser;
}

export class SessionService {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly unlocked = new Map<string, Set<string>>();

  constructor(private readonly io: AppServer) {}

  static onlineFrom(account: Account): OnlineUser {
    return {
      id: account.id,
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
      screenSharing: false,
    };
  }

  register(socket: AppSocket, account: Account): OnlineUser {
    const entry: SessionEntry = { socket, online: SessionService.onlineFrom(account) };
    this.sessions.set(account.id, entry);
    this.broadcastUsers();
    return entry.online;
  }

  unregister(userId: string, socketId: string): OnlineUser | undefined {
    const entry = this.sessions.get(userId);
    if (!entry || entry.socket.id !== socketId) return undefined;
    this.sessions.delete(userId);
    this.unlocked.delete(userId);
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

  has(userId: string): boolean {
    return this.sessions.has(userId);
  }

  get(userId: string): OnlineUser | undefined {
    return this.sessions.get(userId)?.online;
  }

  getSocket(userId: string): AppSocket | undefined {
    return this.sessions.get(userId)?.socket;
  }

  list(): OnlineUser[] {
    return [...this.sessions.values()].map((entry) => entry.online);
  }

  update(userId: string, patch: Partial<OnlineUser>, broadcast = true): OnlineUser | undefined {
    const entry = this.sessions.get(userId);
    if (!entry) return undefined;
    Object.assign(entry.online, patch);
    if (broadcast) this.broadcastUsers();
    return entry.online;
  }

  broadcastUsers(): void {
    this.io.emit('state:users', this.list());
  }

  endSession(userId: string, reason: string): void {
    const entry = this.sessions.get(userId);
    if (!entry) return;
    entry.socket.emit('session:ended', { reason });
    entry.socket.disconnect(true);
  }
}
