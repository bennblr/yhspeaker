import type {
  AdminUser,
  BroadcastGroup,
  Channel,
  ChatMessage,
  PublicServerConfig,
  Role,
  RolePermissions,
  OnlineStatsSummary,
} from '@tsds/shared';

export type { PublicServerConfig } from '@tsds/shared';

export interface InviteSettings {
  code: string;
  allowGuests: boolean;
  inviteRequired: boolean;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(data.error || `Ошибка сервера (${response.status})`);
  }
  return data;
}

export const api = {
  config: () => request<PublicServerConfig>('/api/config'),
  login: (username: string, password: string) =>
    request<{ token: string }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string, displayName?: string) =>
    request<{ token: string }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    }),
  guest: (displayName: string, inviteCode?: string) =>
    request<{ token: string }>('/api/guest', {
      method: 'POST',
      body: JSON.stringify({ displayName, inviteCode }),
    }),
  messages: (channelId: string, token: string) =>
    request<{ messages: ChatMessage[] }>(
      `/api/channels/${encodeURIComponent(channelId)}/messages?limit=100`,
      {},
      token,
    ),
  updateProfile: (token: string, displayName: string) =>
    request<{ account: { displayName: string } }>(
      '/api/profile',
      { method: 'PATCH', body: JSON.stringify({ displayName }) },
      token,
    ),
  adminUsers: (token: string) => request<{ users: AdminUser[] }>('/api/admin/users', {}, token),
  adminStats: (token: string, days: number) =>
    request<{ stats: OnlineStatsSummary; online: number }>(
      `/api/admin/stats?days=${days}`,
      {},
      token,
    ),
  adminInvite: (token: string) => request<InviteSettings>('/api/admin/invite', {}, token),
  setInviteRequired: (token: string, inviteRequired: boolean) =>
    request<InviteSettings>(
      '/api/admin/invite',
      { method: 'PUT', body: JSON.stringify({ inviteRequired }) },
      token,
    ),
  regenerateInvite: (token: string) =>
    request<{ code: string }>('/api/admin/invite/regenerate', { method: 'POST' }, token),
  adminGroups: (token: string) =>
    request<{ groups: BroadcastGroup[] }>('/api/admin/groups', {}, token),
  createGroup: (token: string, body: { name: string; memberIds: string[] }) =>
    request<{ group: BroadcastGroup }>(
      '/api/admin/groups',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
  updateGroup: (token: string, groupId: string, body: { name: string; memberIds: string[] }) =>
    request<{ group: BroadcastGroup }>(
      `/api/admin/groups/${encodeURIComponent(groupId)}`,
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),
  deleteGroup: (token: string, groupId: string) =>
    request<{ ok: boolean }>(
      `/api/admin/groups/${encodeURIComponent(groupId)}`,
      { method: 'DELETE' },
      token,
    ),
  roles: (token: string) => request<{ roles: Role[] }>('/api/admin/roles', {}, token),
  createRole: (
    token: string,
    body: { name: string; color: string; permissions: RolePermissions },
  ) =>
    request<{ role: Role }>(
      '/api/admin/roles',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
  updateRole: (
    token: string,
    roleId: string,
    body: { name: string; color: string; permissions: RolePermissions },
  ) =>
    request<{ role: Role }>(
      `/api/admin/roles/${encodeURIComponent(roleId)}`,
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),
  deleteRole: (token: string, roleId: string) =>
    request<{ ok: boolean }>(
      `/api/admin/roles/${encodeURIComponent(roleId)}`,
      { method: 'DELETE' },
      token,
    ),
};

export type { Channel };
