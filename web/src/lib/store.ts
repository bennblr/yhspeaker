import { create } from 'zustand';
import type {
  BroadcastGroup,
  Channel,
  ChatMessage,
  ClientConfig,
  DirectMessage,
  DmConversation,
  DmParticipant,
  InitState,
  OnlineUser,
  Role,
} from '@tsds/shared';
import { loadSettings, saveSettings, MAX_USER_VOLUME, type MicSettings } from './settings';
import {
  defaultSidebarPrefs,
  loadSidebarPrefs,
  saveSidebarPrefs,
  type SidebarSection,
} from './sidebarPrefs';

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
  // Ключи — идентификаторы подключений: у одного аккаунта может быть несколько устройств.
  remoteScreens: Record<string, MediaStream>;
  viewerSessionId: string | null;
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
  // Всего сохранённых сообщений в канале: приходит с сервера, дальше считаем локально.
  messageCounts: Record<string, number>;
  unread: Record<string, number>;
  // Личные настройки вида сайдбара: свёрнутые разделы и порядок каналов.
  sidebarCollapsed: Record<SidebarSection, boolean>;
  channelOrder: string[];
  // Личные чаты: сообщения по идентификатору собеседника и список переписок.
  dmMessages: Record<string, DirectMessage[]>;
  dmConversations: DmConversation[];
  dmPeer: DmParticipant | null;
  dmUnread: Record<string, number>;
  speaking: string[];
  localMuted: string[];
  // Индивидуальная громкость собеседников: множитель 0–2 к общему уровню.
  userVolumes: Record<string, number>;
  settings: MicSettings;
  voice: VoiceState;
  toasts: Toast[];

  setToken: (token: string | null) => void;
  applyInit: (state: InitState) => void;
  setMe: (me: OnlineUser) => void;
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
  toggleSidebarSection: (section: SidebarSection) => void;
  moveChannel: (sourceId: string, targetId: string, after: boolean) => void;
  setDmConversations: (conversations: DmConversation[]) => void;
  setDmMessages: (peerId: string, messages: DirectMessage[]) => void;
  setDmPeer: (peer: DmParticipant | null) => void;
  addDmMessage: (message: DirectMessage) => void;
  setSpeaking: (userIds: string[]) => void;
  toggleLocalMute: (userId: string) => void;
  setUserVolume: (userId: string, volume: number) => void;
  setSettings: (patch: Partial<MicSettings>) => void;
  patchVoice: (patch: Partial<VoiceState>) => void;
  setLocalScreen: (stream: MediaStream | null) => void;
  setRemoteScreen: (sessionId: string, stream: MediaStream | null) => void;
  setViewer: (sessionId: string | null) => void;
  pushToast: (type: ToastType, text: string) => void;
  dismissToast: (id: number) => void;
  logoutLocal: () => void;
}

const lastChannel = localStorage.getItem('la2speak.lastChannel');
const LOCAL_MUTED_KEY = 'la2speak.localMuted';
const USER_VOLUMES_KEY = 'la2speak.userVolumes';
let toastSeq = 0;

function loadLocalMuted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_MUTED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function loadUserVolumes(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_VOLUMES_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const volumes: Record<string, number> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const volume = Number(value);
      if (!id || !Number.isFinite(volume) || volume === 1) continue;
      volumes[id] = Math.max(0, Math.min(MAX_USER_VOLUME, volume));
    }
    return volumes;
  } catch {
    return {};
  }
}

function orderedChannelIds(channels: Channel[], order: string[]): string[] {
  const known = new Set(channels.map((channel) => channel.id));
  const result = order.filter((id) => known.has(id));
  const seen = new Set(result);
  for (const channel of channels) {
    if (!seen.has(channel.id)) result.push(channel.id);
  }
  return result;
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
  const saved = localStorage.getItem('la2speak.lastChannel');
  if (saved && available.some((channel) => channel.id === saved)) return saved;
  return available.find((channel) => channel.type === 'text')?.id ?? available[0]?.id ?? null;
}

export const useApp = create<AppState>((set, get) => ({
  token: localStorage.getItem('la2speak.token'),
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
  messageCounts: {},
  unread: {},
  sidebarCollapsed: defaultSidebarPrefs().collapsed,
  channelOrder: [],
  dmMessages: {},
  dmConversations: [],
  dmPeer: null,
  dmUnread: {},
  speaking: [],
  localMuted: loadLocalMuted(),
  userVolumes: loadUserVolumes(),
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
    viewerSessionId: null,
  },
  toasts: [],

  setToken: (token) => {
    if (token) localStorage.setItem('la2speak.token', token);
    else localStorage.removeItem('la2speak.token');
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
    if (activeChannelId) localStorage.setItem('la2speak.lastChannel', activeChannelId);
    const me = state.users.find((user) => user.sessionId === state.me.sessionId) ?? state.me;
    const prefs = loadSidebarPrefs(me.id);
    set({
      me,
      users: state.users,
      channels: state.channels,
      broadcastGroups: state.broadcastGroups ?? [],
      roles: state.roles ?? [],
      config: state.config,
      connection: 'online',
      activeChannelId,
      unlockedChannels,
      channelLock: null,
      messageCounts: state.messageCounts ?? {},
      sidebarCollapsed: prefs.collapsed,
      channelOrder: prefs.order,
    });
  },

  setMe: (me) => set({ me }),

  applyUsers: (users) => {
    const me = get().me;
    set({
      users,
      me: me ? (users.find((user) => user.sessionId === me.sessionId) ?? me) : null,
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
    if (active) localStorage.setItem('la2speak.lastChannel', active);
    const known = new Set(channels.map((channel) => channel.id));
    const messageCounts = Object.fromEntries(
      Object.entries(state.messageCounts).filter(([id]) => known.has(id)),
    );
    const channelOrder = state.channelOrder.filter((id) => known.has(id));
    if (channelOrder.length !== state.channelOrder.length) {
      saveSidebarPrefs(state.me?.id, { collapsed: state.sidebarCollapsed, order: channelOrder });
    }
    set({ channels, activeChannelId: active, unlockedChannels, messageCounts, channelOrder });
  },

  setBroadcastGroups: (broadcastGroups) => set({ broadcastGroups }),

  setRoles: (roles) => set({ roles }),

  setConnection: (connection) => set({ connection }),

  setActiveChannel: (channelId) => {
    localStorage.setItem('la2speak.lastChannel', channelId);
    set((state) => ({
      activeChannelId: channelId,
      unread: { ...state.unread, [channelId]: 0 },
      dmPeer: null,
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
      // Старый сервер мог не прислать счётчики: тогда опираемся на загруженную историю.
      messageCounts:
        state.messageCounts[channelId] === undefined
          ? { ...state.messageCounts, [channelId]: messages.length }
          : state.messageCounts,
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
      messageCounts: {
        ...state.messageCounts,
        [message.channelId]: (state.messageCounts[message.channelId] ?? list.length) + 1,
      },
      unread: isActive
        ? state.unread
        : { ...state.unread, [message.channelId]: (state.unread[message.channelId] ?? 0) + 1 },
    });
  },

  removeMessage: (channelId, messageId) => {
    const state = get();
    const count = state.messageCounts[channelId];
    const messageCounts =
      count === undefined
        ? state.messageCounts
        : { ...state.messageCounts, [channelId]: Math.max(0, count - 1) };
    const list = state.messages[channelId];
    if (!list) {
      if (messageCounts !== state.messageCounts) set({ messageCounts });
      return;
    }
    set({
      messages: {
        ...state.messages,
        [channelId]: list.filter((message) => message.id !== messageId),
      },
      messageCounts,
    });
  },

  toggleSidebarSection: (section) => {
    const state = get();
    const sidebarCollapsed = {
      ...state.sidebarCollapsed,
      [section]: !state.sidebarCollapsed[section],
    };
    saveSidebarPrefs(state.me?.id, { collapsed: sidebarCollapsed, order: state.channelOrder });
    set({ sidebarCollapsed });
  },

  moveChannel: (sourceId, targetId, after) => {
    const state = get();
    const source = state.channels.find((channel) => channel.id === sourceId);
    const target = state.channels.find((channel) => channel.id === targetId);
    // Переставляем только внутри своего раздела: голосовые и текстовые не смешиваются.
    if (!source || !target || source.type !== target.type || sourceId === targetId) return;
    const ids = orderedChannelIds(state.channels, state.channelOrder);
    const from = ids.indexOf(sourceId);
    if (from === -1) return;
    ids.splice(from, 1);
    const to = ids.indexOf(targetId);
    if (to === -1) return;
    ids.splice(after ? to + 1 : to, 0, sourceId);
    saveSidebarPrefs(state.me?.id, { collapsed: state.sidebarCollapsed, order: ids });
    set({ channelOrder: ids });
  },

  setDmConversations: (dmConversations) => set({ dmConversations }),

  setDmMessages: (peerId, messages) => {
    set((state) => ({
      dmMessages: { ...state.dmMessages, [peerId]: messages },
    }));
  },

  setDmPeer: (dmPeer) => {
    set((state) => ({
      dmPeer,
      dmUnread: dmPeer ? { ...state.dmUnread, [dmPeer.id]: 0 } : state.dmUnread,
    }));
  },

  addDmMessage: (message) => {
    const state = get();
    const meId = state.me?.id;
    if (!meId) return;
    const fromMe = message.from.id === meId;
    const peer = fromMe ? message.to : message.from;
    const list = state.dmMessages[peer.id] ?? [];
    if (list.some((item) => item.id === message.id)) return;
    const active = state.dmPeer?.id === peer.id;
    const previous = state.dmConversations.find((item) => item.peer.id === peer.id);
    set({
      dmMessages: { ...state.dmMessages, [peer.id]: [...list, message].slice(-300) },
      dmConversations: [
        {
          peer,
          last: message,
          count: previous ? (previous.count === undefined ? undefined : previous.count + 1) : 1,
        },
        ...state.dmConversations.filter((item) => item.peer.id !== peer.id),
      ],
      dmUnread:
        active || fromMe
          ? state.dmUnread
          : { ...state.dmUnread, [peer.id]: (state.dmUnread[peer.id] ?? 0) + 1 },
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

  setUserVolume: (userId, volume) => {
    const value = Number.isFinite(volume)
      ? Math.max(0, Math.min(MAX_USER_VOLUME, volume))
      : 1;
    const userVolumes = { ...get().userVolumes };
    if (Math.abs(value - 1) < 0.005) delete userVolumes[userId];
    else userVolumes[userId] = Math.round(value * 100) / 100;
    try {
      localStorage.setItem(USER_VOLUMES_KEY, JSON.stringify(userVolumes));
    } catch {
      /* storage unavailable */
    }
    set({ userVolumes });
  },

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
  },

  patchVoice: (patch) => set((state) => ({ voice: { ...state.voice, ...patch } })),

  setLocalScreen: (stream) => set((state) => ({ voice: { ...state.voice, localScreen: stream } })),

  setRemoteScreen: (sessionId, stream) => {
    set((state) => {
      const remoteScreens = { ...state.voice.remoteScreens };
      if (stream) remoteScreens[sessionId] = stream;
      else delete remoteScreens[sessionId];
      return {
        voice: {
          ...state.voice,
          remoteScreens,
          viewerSessionId:
            !stream && state.voice.viewerSessionId === sessionId
              ? null
              : state.voice.viewerSessionId,
        },
      };
    });
  },

  setViewer: (sessionId) => set((state) => ({ voice: { ...state.voice, viewerSessionId: sessionId } })),

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
    localStorage.removeItem('la2speak.token');
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
      messageCounts: {},
      unread: {},
      sidebarCollapsed: defaultSidebarPrefs().collapsed,
      channelOrder: [],
      dmMessages: {},
      dmConversations: [],
      dmPeer: null,
      dmUnread: {},
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
        viewerSessionId: null,
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
