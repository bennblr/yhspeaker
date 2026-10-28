import { create } from 'zustand';
import type {
  BroadcastGroup,
  Channel,
  ChatMessage,
  ClientConfig,
  InitState,
  OnlineUser,
  Role,
} from '@tsds/shared';
import { loadSettings, saveSettings, type MicSettings } from './settings';

export type ToastType = 'ok' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  text: string;
}

export interface VoiceState {
  channelId: string | null;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  pttActive: boolean;
  micReady: boolean;
  localScreen: MediaStream | null;
  remoteScreens: Record<string, MediaStream>;
  viewerUserId: string | null;
}

export interface ChannelLock {
  channelId: string;
  channelName: string;
  action: 'select' | 'join';
}

export interface AppState {
  token: string | null;
  me: OnlineUser | null;
  users: OnlineUser[];
  channels: Channel[];
  broadcastGroups: BroadcastGroup[];
  roles: Role[];
  config: ClientConfig | null;
  connection: 'connecting' | 'online' | 'offline';
  activeChannelId: string | null;
  unlockedChannels: string[];
  channelLock: ChannelLock | null;
  messages: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  speaking: string[];
  localMuted: string[];
  settings: MicSettings;
  voice: VoiceState;
  toasts: Toast[];

  setToken: (token: string | null) => void;
  applyInit: (state: InitState) => void;
  applyUsers: (users: OnlineUser[]) => void;
  applyChannels: (channels: Channel[]) => void;
  setBroadcastGroups: (groups: BroadcastGroup[]) => void;
  setRoles: (roles: Role[]) => void;
  setConnection: (connection: AppState['connection']) => void;
  setActiveChannel: (channelId: string) => void;
  markChannelUnlocked: (channelId: string) => void;
  setChannelLock: (lock: ChannelLock | null) => void;
  clearChannelUnlocks: () => void;
  setMessages: (channelId: string, messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  setSpeaking: (userIds: string[]) => void;
  toggleLocalMute: (userId: string) => void;
  setSettings: (patch: Partial<MicSettings>) => void;
  patchVoice: (patch: Partial<VoiceState>) => void;
  setLocalScreen: (stream: MediaStream | null) => void;
  setRemoteScreen: (userId: string, stream: MediaStream | null) => void;
  setViewer: (userId: string | null) => void;
  pushToast: (type: ToastType, text: string) => void;
  dismissToast: (id: number) => void;
  logoutLocal: () => void;
}

const lastChannel = localStorage.getItem('yhspeak.lastChannel');
const LOCAL_MUTED_KEY = 'yhspeak.localMuted';
let toastSeq = 0;

function loadLocalMuted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_MUTED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function canOpenChannel(channel: Channel, unlocked: string[], isAdmin: boolean): boolean {
  return !channel.passwordProtected || isAdmin || unlocked.includes(channel.id);
}

function pickDefaultChannel(
  channels: Channel[],
  current: string | null,
  unlocked: string[],
  isAdmin: boolean,
): string | null {
  const available = channels.filter((channel) => canOpenChannel(channel, unlocked, isAdmin));
  if (current && available.some((channel) => channel.id === current)) return current;
  const saved = localStorage.getItem('yhspeak.lastChannel');
  if (saved && available.some((channel) => channel.id === saved)) return saved;
  return available.find((channel) => channel.type === 'text')?.id ?? available[0]?.id ?? null;
}

export const useApp = create<AppState>((set, get) => ({
  token: localStorage.getItem('yhspeak.token'),
  me: null,
  users: [],
  channels: [],
  broadcastGroups: [],
  roles: [],
  config: null,
  connection: 'connecting',
  activeChannelId: lastChannel,
  unlockedChannels: [],
  channelLock: null,
  messages: {},
  unread: {},
  speaking: [],
  localMuted: loadLocalMuted(),
  settings: loadSettings(),
  voice: {
    channelId: null,
    connecting: false,
    muted: false,
    deafened: false,
    pttActive: false,
    micReady: false,
    localScreen: null,
    remoteScreens: {},
    viewerUserId: null,
  },
  toasts: [],

  setToken: (token) => {
    if (token) localStorage.setItem('yhspeak.token', token);
    else localStorage.removeItem('yhspeak.token');
    set({ token });
  },

  applyInit: (state) => {
    const current = get().activeChannelId;
    const unlockedChannels: string[] = [];
    const activeChannelId = pickDefaultChannel(
      state.channels,
      current,
      unlockedChannels,
      state.me.role === 'admin',
    );
    if (activeChannelId) localStorage.setItem('yhspeak.lastChannel', activeChannelId);
    set({
      me: state.users.find((user) => user.id === state.me.id) ?? state.me,
      users: state.users,
      channels: state.channels,
      broadcastGroups: state.broadcastGroups ?? [],
      roles: state.roles ?? [],
      config: state.config,
      connection: 'online',
      activeChannelId,
      unlockedChannels,
      channelLock: null,
    });
  },

  applyUsers: (users) => {
    const me = get().me;
    set({
      users,
      me: me ? (users.find((user) => user.id === me.id) ?? me) : null,
    });
  },

  applyChannels: (channels) => {
    const state = get();
    const unlockedChannels = state.unlockedChannels.filter((id) =>
      channels.some((channel) => channel.id === id),
    );
    const active = pickDefaultChannel(
      channels,
      state.activeChannelId,
      unlockedChannels,
      state.me?.role === 'admin',
    );
    if (active) localStorage.setItem('yhspeak.lastChannel', active);
    set({ channels, activeChannelId: active, unlockedChannels });
  },

  setBroadcastGroups: (broadcastGroups) => set({ broadcastGroups }),

  setRoles: (roles) => set({ roles }),

  setConnection: (connection) => set({ connection }),

  setActiveChannel: (channelId) => {
    localStorage.setItem('yhspeak.lastChannel', channelId);
    set((state) => ({
      activeChannelId: channelId,
      unread: { ...state.unread, [channelId]: 0 },
    }));
  },

  markChannelUnlocked: (channelId) => {
    set((state) => ({
      unlockedChannels: state.unlockedChannels.includes(channelId)
        ? state.unlockedChannels
        : [...state.unlockedChannels, channelId],
    }));
  },

  setChannelLock: (channelLock) => set({ channelLock }),

  clearChannelUnlocks: () => set({ unlockedChannels: [], channelLock: null }),

  setMessages: (channelId, messages) => {
    set((state) => ({
      messages: { ...state.messages, [channelId]: messages },
    }));
  },

  addMessage: (message) => {
    const state = get();
    const list = state.messages[message.channelId] ?? [];
    if (list.some((item) => item.id === message.id)) return;
    const next = [...list, message].slice(-300);
    const isActive = state.activeChannelId === message.channelId;
    set({
      messages: { ...state.messages, [message.channelId]: next },
      unread: isActive
        ? state.unread
        : { ...state.unread, [message.channelId]: (state.unread[message.channelId] ?? 0) + 1 },
    });
  },

  removeMessage: (channelId, messageId) => {
    const state = get();
    const list = state.messages[channelId];
    if (!list) return;
    set({
      messages: {
        ...state.messages,
        [channelId]: list.filter((message) => message.id !== messageId),
      },
    });
  },

  setSpeaking: (userIds) => set({ speaking: userIds }),

  toggleLocalMute: (userId) => {
    const state = get();
    const active = state.localMuted.includes(userId);
    const localMuted = active
      ? state.localMuted.filter((id) => id !== userId)
      : [...state.localMuted, userId];
    localStorage.setItem(LOCAL_MUTED_KEY, JSON.stringify(localMuted));
    set({ localMuted });
    state.pushToast(
      'info',
      active ? 'Звук участника снова включён' : 'Участник заглушён только у вас',
    );
  },

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
  },

  patchVoice: (patch) => set((state) => ({ voice: { ...state.voice, ...patch } })),

  setLocalScreen: (stream) => set((state) => ({ voice: { ...state.voice, localScreen: stream } })),

  setRemoteScreen: (userId, stream) => {
    set((state) => {
      const remoteScreens = { ...state.voice.remoteScreens };
      if (stream) remoteScreens[userId] = stream;
      else delete remoteScreens[userId];
      return {
        voice: {
          ...state.voice,
          remoteScreens,
          viewerUserId: !stream && state.voice.viewerUserId === userId ? null : state.voice.viewerUserId,
        },
      };
    });
  },

  setViewer: (userId) => set((state) => ({ voice: { ...state.voice, viewerUserId: userId } })),

  pushToast: (type, text) => {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, type, text }] }));
    setTimeout(() => {
      useApp.setState((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 4500);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  logoutLocal: () => {
    localStorage.removeItem('yhspeak.token');
    set({
      token: null,
      me: null,
      users: [],
      channels: [],
      broadcastGroups: [],
      roles: [],
      config: null,
      connection: 'connecting',
      activeChannelId: null,
      unlockedChannels: [],
      channelLock: null,
      messages: {},
      unread: {},
      speaking: [],
      voice: {
        channelId: null,
        connecting: false,
        muted: false,
        deafened: false,
        pttActive: false,
        micReady: false,
        localScreen: null,
        remoteScreens: {},
        viewerUserId: null,
      },
      toasts: [],
    });
  },
}));

export function isSelfMicMuted(state: Pick<AppState, 'me' | 'voice' | 'settings'>): boolean {
  if (!state.voice.channelId) return state.voice.muted || state.voice.deafened;
  return (
    Boolean(state.me?.serverMuted) ||
    state.voice.muted ||
    state.voice.deafened ||
    !state.voice.micReady ||
    (state.settings.mode === 'ptt' && !state.voice.pttActive)
  );
}

export function totalUnread(unread: Record<string, number>): number {
  return Object.values(unread).reduce((sum, value) => sum + value, 0);
}
