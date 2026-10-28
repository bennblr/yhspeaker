export const APP_VERSION = '1.0.0';
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_DISPLAY_NAME = 32;
export const MAX_LABEL_LENGTH = 20;
export const MAX_CHANNEL_NAME = 32;
export const MAX_GROUP_NAME = 40;
export const MAX_ROLE_NAME = 40;
export const MIN_VOICE_PARTICIPANTS = 1;
export const MAX_VOICE_PARTICIPANTS = 150;

export type BaseRole = 'admin' | 'moderator' | 'member' | 'guest';
export const BASE_ROLES: BaseRole[] = ['guest', 'member', 'moderator', 'admin'];
export const BASE_ROLE_LABELS: Record<BaseRole, string> = {
  guest: 'Гость',
  member: 'Пользователь',
  moderator: 'Модератор',
  admin: 'Админ',
};
export type ChannelType = 'voice' | 'text';
export type ProducerSource = 'mic' | 'screen';
export type MediaKind = 'audio' | 'video';

export type PermissionKey =
  | 'broadcast'
  | 'moderate'
  | 'channels'
  | 'roles'
  | 'groups'
  | 'invite';

export interface RolePermissions {
  broadcast: boolean;
  moderate: boolean;
  channels: boolean;
  roles: boolean;
  groups: boolean;
  invite: boolean;
}

export interface Role {
  id: string;
  name: string;
  color: string;
  permissions: RolePermissions;
  createdAt: number;
}

export const NO_PERMISSIONS: RolePermissions = {
  broadcast: false,
  moderate: false,
  channels: false,
  roles: false,
  groups: false,
  invite: false,
};

export function hasPermission(
  user: { role: BaseRole; roleIds?: string[] } | null | undefined,
  roles: Role[],
  permission: PermissionKey,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'guest') return false;
  if (user.role === 'moderator' && permission === 'moderate') return true;
  return (user.roleIds ?? []).some((id) => {
    const role = roles.find((item) => item.id === id);
    return role?.permissions[permission] === true;
  });
}

export function hasAnyPermission(
  user: { role: BaseRole; roleIds?: string[] } | null | undefined,
  roles: Role[],
): boolean {
  return (Object.keys(NO_PERMISSIONS) as PermissionKey[]).some((permission) =>
    hasPermission(user, roles, permission),
  );
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  guest?: boolean;
  passwordProtected?: boolean;
  visibleRoles: BaseRole[];
  visibleRoleIds: string[];
  createdAt: number;
}

export function isChannelVisible(
  user: { role: BaseRole; roleIds?: string[] } | null | undefined,
  channel: Pick<Channel, 'guest' | 'visibleRoles' | 'visibleRoleIds'>,
): boolean {
  if (!user) return false;
  // Видимость каналов ограничивает только гостей: пользователь и выше
  // получают доступ ко всем каналам сервера.
  if (user.role !== 'guest') return true;
  if (channel.guest) return true;
  return channel.visibleRoles.includes('guest');
}

export interface OnlineUser {
  id: string;
  username: string;
  displayName: string;
  label?: string;
  role: BaseRole;
  roleIds: string[];
  isGuest: boolean;
  channelId: string | null;
  muted: boolean;
  serverMuted: boolean;
  deafened: boolean;
  broadcasting: boolean;
  broadcastAll: boolean;
  broadcastGroupIds: string[];
  screenSharing: boolean;
}

export interface BroadcastGroup {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: number;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  label?: string;
  role: BaseRole;
  roleIds: string[];
  isGuest: boolean;
  banned: boolean;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  displayName: string;
  label?: string;
  role: BaseRole;
  text: string;
  ts: number;
}

export interface PublicServerConfig {
  serverName: string;
  allowGuests: boolean;
  guestInviteRequired: boolean;
  maxParticipants: number;
  version: string;
}

export interface ClientConfig extends PublicServerConfig {
  guestInviteCode?: string;
  maxMessageLength: number;
}

export interface InitState {
  me: OnlineUser;
  users: OnlineUser[];
  channels: Channel[];
  broadcastGroups: BroadcastGroup[];
  roles: Role[];
  routerRtpCapabilities: unknown;
  config: ClientConfig;
}

export interface TransportParams {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
}

export interface ConsumerParams {
  consumerId: string;
  producerId: string;
  userId: string;
  kind: MediaKind;
  source: ProducerSource;
  rtpParameters: unknown;
  serverMuted: boolean;
}

export interface SpeakerInfo {
  userId: string;
  volume: number;
}

export const STATS_SAMPLE_MS = 30_000;
export const STATS_BUCKET_MS = 5 * 60_000;

export interface OnlineStatsBucket {
  t: number;
  sum: number;
  samples: number;
  peak: number;
}

export interface OnlineStatsUserDay {
  userId: string;
  displayName: string;
  guest: boolean;
  seconds: number;
  sessions: number;
  lastSeen: number;
}

export interface OnlineStatsDay {
  date: string;
  buckets: OnlineStatsBucket[];
  users: Record<string, OnlineStatsUserDay>;
}

export interface OnlineStatsFile {
  version: 1;
  days: Record<string, OnlineStatsDay>;
}

export function statsDateKey(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface OnlineStatsPoint {
  t: number;
  avg: number;
  peak: number;
}

export interface OnlineStatsUser {
  userId: string;
  displayName: string;
  guest: boolean;
  seconds: number;
  sessions: number;
  lastSeen: number;
}

export interface OnlineStatsDaySummary {
  date: string;
  peak: number;
  average: number;
  seconds: number;
  users: number;
}

export interface OnlineStatsSummary {
  from: number;
  to: number;
  bucketMs: number;
  peak: number;
  average: number;
  uniqueUsers: number;
  totalSeconds: number;
  sessions: number;
  timeline: OnlineStatsPoint[];
  daily: OnlineStatsDaySummary[];
  users: OnlineStatsUser[];
}

export function summarizeOnlineStats(
  days: OnlineStatsDay[],
  from: number,
  to: number,
): OnlineStatsSummary {
  const bucketMs = to - from > 14 * 24 * 3_600_000 ? 6 * 3_600_000 : 3_600_000;
  let peak = 0;
  let sum = 0;
  let samples = 0;
  let totalSeconds = 0;
  let sessions = 0;
  const timeline = new Map<number, { sum: number; samples: number; peak: number }>();
  const users = new Map<string, OnlineStatsUser>();
  const daily: OnlineStatsDaySummary[] = [];

  for (const day of days) {
    let dayPeak = 0;
    let daySum = 0;
    let daySamples = 0;
    let daySeconds = 0;
    for (const bucket of day.buckets) {
      if (bucket.t + STATS_BUCKET_MS <= from || bucket.t >= to) continue;
      dayPeak = Math.max(dayPeak, bucket.peak);
      daySum += bucket.sum;
      daySamples += bucket.samples;
      const key = Math.floor(bucket.t / bucketMs) * bucketMs;
      const point = timeline.get(key) ?? { sum: 0, samples: 0, peak: 0 };
      point.sum += bucket.sum;
      point.samples += bucket.samples;
      point.peak = Math.max(point.peak, bucket.peak);
      timeline.set(key, point);
    }
    for (const user of Object.values(day.users)) {
      if (user.lastSeen < from) continue;
      daySeconds += user.seconds;
      totalSeconds += user.seconds;
      sessions += user.sessions;
      const merged = users.get(user.userId);
      if (merged) {
        merged.seconds += user.seconds;
        merged.sessions += user.sessions;
        if (user.lastSeen >= merged.lastSeen) {
          merged.lastSeen = user.lastSeen;
          merged.displayName = user.displayName;
          merged.guest = user.guest;
        }
      } else {
        users.set(user.userId, { ...user });
      }
    }
    peak = Math.max(peak, dayPeak);
    sum += daySum;
    samples += daySamples;
    daily.push({
      date: day.date,
      peak: dayPeak,
      average: daySamples ? daySum / daySamples : 0,
      seconds: daySeconds,
      users: Object.keys(day.users).length,
    });
  }

  return {
    from,
    to,
    bucketMs,
    peak,
    average: samples ? sum / samples : 0,
    uniqueUsers: users.size,
    totalSeconds,
    sessions,
    timeline: [...timeline.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, point]) => ({
        t,
        avg: point.samples ? point.sum / point.samples : 0,
        peak: point.peak,
      })),
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    users: [...users.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

export type AckResult = { ok: boolean; error?: string };

export interface AuthorizeGuestResult extends AckResult {
  username?: string;
  password?: string;
}

export interface ServerToClientEvents {
  'state:init': (state: InitState) => void;
  'state:users': (users: OnlineUser[]) => void;
  'channels:update': (channels: Channel[]) => void;
  'groups:update': (groups: BroadcastGroup[]) => void;
  'roles:update': (roles: Role[]) => void;
  'config:update': (config: PublicServerConfig) => void;
  'chat:message': (message: ChatMessage) => void;
  'chat:deleted': (payload: { channelId: string; messageId: string }) => void;
  'voice:transports': (payload: { send: TransportParams; recv: TransportParams }) => void;
  'voice:newConsumer': (consumer: ConsumerParams) => void;
  'voice:consumerClosed': (payload: { consumerId: string }) => void;
  'voice:activeSpeakers': (speakers: SpeakerInfo[]) => void;
  'voice:kicked': (payload: { channelName: string; byName: string }) => void;
  'voice:moved': (payload: { channelId: string; channelName: string; byName: string }) => void;
  'voice:joinFailed': (payload: { message: string }) => void;
  'voice:serverMuted': (payload: { userId: string; muted: boolean }) => void;
  toast: (payload: { type: 'ok' | 'error' | 'info'; text: string }) => void;
  'session:ended': (payload: { reason: string }) => void;
  'session:token': (payload: { token: string }) => void;
}

export interface ClientToServerEvents {
  'chat:send': (
    payload: { channelId: string; text: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'channel:unlock': (
    payload: { channelId: string; password: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'voice:join': (payload: { channelId: string }, ack?: (res: AckResult) => void) => void;
  'voice:leave': () => void;
  'voice:connectTransport': (
    payload: { direction: 'send' | 'recv'; dtlsParameters: unknown },
    ack?: (res: AckResult) => void,
  ) => void;
  'voice:produce': (
    payload: { kind: MediaKind; rtpParameters: unknown; source: ProducerSource },
    ack: (res: { id?: string; error?: string }) => void,
  ) => void;
  'voice:closeProducer': (payload: { producerId: string }) => void;
  'voice:resumeConsumer': (
    payload: { consumerId: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'voice:ready': (payload: { rtpCapabilities: unknown }, ack?: (res: AckResult) => void) => void;
  'voice:setMuted': (payload: { muted: boolean }) => void;
  'voice:setDeafened': (payload: { deafened: boolean }) => void;
  'voice:setBroadcast': (
    payload: { all: boolean; groupIds: string[] },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:serverMute': (
    payload: { userId: string; muted: boolean },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:kick': (payload: { userId: string }, ack?: (res: AckResult) => void) => void;
  'mod:ban': (
    payload: { userId: string; banned: boolean },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:setRole': (
    payload: { userId: string; role: BaseRole },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:setLabel': (
    payload: { userId: string; label: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:moveUser': (
    payload: { userId: string; channelId: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:setUserRoles': (
    payload: { userId: string; roleIds: string[] },
    ack?: (res: AckResult) => void,
  ) => void;
  'mod:authorizeGuest': (
    payload: { userId: string },
    ack?: (res: AuthorizeGuestResult) => void,
  ) => void;
  'admin:createChannel': (
    payload: {
      name: string;
      type: ChannelType;
      password?: string;
      visibleRoles?: BaseRole[];
      visibleRoleIds?: string[];
    },
    ack?: (res: AckResult) => void,
  ) => void;
  'admin:updateChannel': (
    payload: {
      channelId: string;
      name: string;
      password?: string;
      visibleRoles?: BaseRole[];
      visibleRoleIds?: string[];
    },
    ack?: (res: AckResult) => void,
  ) => void;
  'admin:deleteChannel': (payload: { channelId: string }, ack?: (res: AckResult) => void) => void;
  'admin:deleteMessage': (payload: { channelId: string; messageId: string }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  userId: string;
}
