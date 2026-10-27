export const APP_VERSION = '1.0.0';
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_DISPLAY_NAME = 32;
export const MAX_CHANNEL_NAME = 32;
export const MAX_GROUP_NAME = 40;
export const MAX_ROLE_NAME = 40;
export const MIN_VOICE_PARTICIPANTS = 1;
export const MAX_VOICE_PARTICIPANTS = 150;

export type BaseRole = 'admin' | 'member' | 'guest';
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
  if (user.role !== 'member') return false;
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
  createdAt: number;
}

export interface OnlineUser {
  id: string;
  username: string;
  displayName: string;
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
    payload: { userId: string; role: 'admin' | 'member' },
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
    payload: { name: string; type: ChannelType; password?: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'admin:updateChannel': (
    payload: { channelId: string; name: string; password?: string },
    ack?: (res: AckResult) => void,
  ) => void;
  'admin:deleteChannel': (payload: { channelId: string }, ack?: (res: AckResult) => void) => void;
  'admin:deleteMessage': (payload: { channelId: string; messageId: string }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  userId: string;
}
