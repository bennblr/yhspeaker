import type { OnlineStatsSummary } from '@tsds/shared';

export type PlatformStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface PlatformServer {
  id: string;
  name: string;
  domains: string[];
  httpPort: number;
  rtcMinPort: number;
  rtcMaxPort: number;
  maxParticipants: number;
  adminLogin: string;
  createdAt: number;
  desiredRunning: boolean;
  status: PlatformStatus;
  lastError?: string;
  startedAt?: number;
  restarts: number;
}

export interface PlatformMeta {
  publicHost: string;
  tenantDomainSuffix: string;
  announcedIp: string;
  httpPortStart: number;
  httpPortEnd: number;
  rtcPoolStart: number;
  rtcPoolEnd: number;
  defaultMaxParticipants: number;
  maxParticipantsLimit: number;
  adminLogin: string;
  version: string;
  desktop: {
    available: boolean;
    fileName: string | null;
    size: number;
  };
}

export interface PlatformSystem {
  cpu: {
    percent: number;
    cores: number;
    load1: number;
    load5: number;
    load15: number;
  };
  memory: {
    percent: number;
    used: number;
    total: number;
  };
  disk: {
    percent: number;
    used: number;
    total: number;
  } | null;
}

export interface PlatformOverview {
  servers: PlatformServer[];
  meta: PlatformMeta;
  system: PlatformSystem;
}

export interface TenantCredentials {
  login: string;
  password: string;
}

export interface CreateServerResponse {
  server: PlatformServer;
  credentials: TenantCredentials;
}

export class PlatformApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'yhspeak.platform.token';

export function loadPlatformToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function savePlatformToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(`/api/platform${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new PlatformApiError(data.error || `Ошибка платформы (${response.status})`, response.status);
  }
  return data;
}

export const platformApi = {
  login: (login: string, password: string) =>
    request<{ token: string; admin: { login: string } }>('/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),
  overview: (token: string) => request<PlatformOverview>('/overview', {}, token),
  createServer: (
    token: string,
    body: {
      name: string;
      domains: string[];
      maxParticipants?: number;
      adminLogin?: string;
      adminPassword?: string;
    },
  ) =>
    request<CreateServerResponse>(
      '/servers',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
  updateServer: (
    token: string,
    id: string,
    body: { name?: string; domains?: string[]; maxParticipants?: number },
  ) =>
    request<{ server: PlatformServer }>(
      `/servers/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),
  start: (token: string, id: string) =>
    request<{ server: PlatformServer }>(
      `/servers/${encodeURIComponent(id)}/start`,
      { method: 'POST' },
      token,
    ),
  stop: (token: string, id: string) =>
    request<{ server: PlatformServer }>(
      `/servers/${encodeURIComponent(id)}/stop`,
      { method: 'POST' },
      token,
    ),
  restart: (token: string, id: string) =>
    request<{ server: PlatformServer }>(
      `/servers/${encodeURIComponent(id)}/restart`,
      { method: 'POST' },
      token,
    ),
  credentials: (token: string, id: string) =>
    request<TenantCredentials>(`/servers/${encodeURIComponent(id)}/credentials`, {}, token),
  stats: (token: string, id: string, days: number) =>
    request<{ stats: OnlineStatsSummary }>(
      `/servers/${encodeURIComponent(id)}/stats?days=${days}`,
      {},
      token,
    ),
  remove: (token: string, id: string, confirmName: string) =>
    request<{ ok: boolean; archivedTo: string | null }>(
      `/servers/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: JSON.stringify({ confirmName }) },
      token,
    ),
};
