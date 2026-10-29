import { useApp } from './store';
import { getSocket, disconnectSocket } from './socket';
import { voice } from './voice';
import type { MicSettings } from './settings';
import { hasPermission, type Channel, type OnlineUser } from '@tsds/shared';

export function toast(type: 'ok' | 'error' | 'info', text: string): void {
  useApp.getState().pushToast(type, text);
}

export function loginWithToken(token: string): void {
  useApp.getState().setToken(token);
}

export function logout(): void {
  getSocket()?.disconnect();
  disconnectSocket();
  voice.reset();
  useApp.getState().logoutLocal();
}

function requiresPassword(channel: Channel): boolean {
  const state = useApp.getState();
  if (!channel.passwordProtected) return false;
  if (state.me?.role === 'admin') return false;
  return !state.unlockedChannels.includes(channel.id);
}

export function selectChannel(channelId: string): void {
  const state = useApp.getState();
  const channel = state.channels.find((item) => item.id === channelId);
  if (channel && requiresPassword(channel)) {
    state.setChannelLock({ channelId, channelName: channel.name, action: 'select' });
    return;
  }
  state.setActiveChannel(channelId);
}

export async function joinVoice(channelId: string): Promise<void> {
  const state = useApp.getState();
  const channel = state.channels.find((item) => item.id === channelId);
  if (channel && requiresPassword(channel)) {
    state.setChannelLock({ channelId, channelName: channel.name, action: 'join' });
    return;
  }
  state.setActiveChannel(channelId);
  await voice.join(channelId);
}

export function leaveVoice(): void {
  voice.leave();
}

export function canDragUser(user: OnlineUser): boolean {
  const state = useApp.getState();
  if (!user.channelId) return false;
  return user.id === state.me?.id || hasPermission(state.me, state.roles, 'moderate');
}

export function moveUserToChannel(user: OnlineUser, channel: Channel): void {
  const state = useApp.getState();
  if (channel.type !== 'voice' || !user.channelId || user.channelId === channel.id) return;
  if (user.id === state.me?.id) {
    void joinVoice(channel.id);
    return;
  }
  if (!hasPermission(state.me, state.roles, 'moderate')) {
    toast('error', 'Недостаточно прав для перемещения участников');
    return;
  }
  const socket = getSocket();
  if (!socket?.connected) {
    toast('error', 'Нет соединения с сервером');
    return;
  }
  socket.emit(
    'mod:moveUser',
    { userId: user.id, sessionId: user.sessionId, channelId: channel.id },
    (result) => {
      if (!result.ok) toast('error', result.error ?? 'Не удалось переместить участника');
      else toast('ok', `${user.displayName} → «${channel.name}»`);
    },
  );
}

export function toggleMute(): void {
  voice.setMuted(!useApp.getState().voice.muted);
}

export function toggleDeafen(): void {
  voice.setDeafened(!useApp.getState().voice.deafened);
}

export async function toggleMic(): Promise<void> {
  const state = useApp.getState();
  if (!state.voice.channelId) {
    toast('info', 'Сначала войдите в голосовой канал');
    return;
  }
  if (!state.voice.micReady) {
    await voice.enableMic();
    return;
  }
  voice.setMuted(!state.voice.muted);
}

export interface BroadcastState {
  all: boolean;
  groupIds: string[];
  // Приоритетное вещание: слушатели слышат только вещающего.
  priority: boolean;
}

export function setBroadcastTargets(targets: BroadcastState, successText?: string): void {
  const state = useApp.getState();
  const socket = getSocket();
  if (!socket) return;
  if (!hasPermission(state.me, state.roles, 'broadcast')) {
    toast('error', 'Недостаточно прав для вещания во все каналы');
    return;
  }
  if (!state.voice.channelId) {
    toast('info', 'Сначала войдите в голосовой канал');
    return;
  }
  socket.emit('voice:setBroadcast', targets, (result) => {
    if (!result.ok) {
      toast('error', result.error ?? 'Не удалось переключить вещание');
      return;
    }
    if (successText) toast('ok', successText);
  });
}

function broadcastWord(priority: boolean): string {
  return priority ? 'Приоритетное вещание' : 'Вещание';
}

export function toggleBroadcastAll(priority: boolean): void {
  const state = useApp.getState();
  const me = state.me;
  if (!me) return;
  // Повторное нажатие той же клавиши выключает цель; клавиша другого режима
  // переключает вещание между обычным и приоритетным.
  const active = me.broadcastAll && me.broadcastPriority === priority;
  const all = !active;
  const groupIds = me.broadcastGroupIds;
  let message: string;
  if (all) message = `${broadcastWord(priority)} включено во все голосовые каналы`;
  else if (groupIds.length > 0) message = 'Вещание во все каналы выключено, группы остались';
  else message = 'Вещание остановлено';
  setBroadcastTargets({ all, groupIds, priority }, message);
}

export function toggleBroadcastGroup(groupId: string, priority: boolean): void {
  const state = useApp.getState();
  const me = state.me;
  if (!me) return;
  const group = state.broadcastGroups.find((item) => item.id === groupId);
  if (!group) return;
  const active = me.broadcastGroupIds.includes(groupId) && me.broadcastPriority === priority;
  const groupIds = active
    ? me.broadcastGroupIds.filter((id) => id !== groupId)
    : [...me.broadcastGroupIds, groupId];
  let message: string;
  if (!active) message = `${broadcastWord(priority)} включено для группы «${group.name}»`;
  else if (me.broadcastAll || groupIds.length > 0) message = `Группа «${group.name}» убрана из вещания`;
  else message = 'Вещание остановлено';
  setBroadcastTargets({ all: me.broadcastAll, groupIds, priority }, message);
}

export function stopBroadcast(): void {
  heldBroadcastTargets.clear();
  broadcastHold = null;
  const me = useApp.getState().me;
  if (!me) return;
  setBroadcastTargets({ all: false, groupIds: [], priority: false }, 'Вещание остановлено');
}

// Режим удержания: запоминаем состояние до нажатия и возвращаем его,
// когда все удерживаемые клавиши отпущены.
let broadcastHold: BroadcastState | null = null;
const heldBroadcastTargets = new Set<string>();

function holdKey(target: string, priority: boolean): string {
  return priority ? `priority:${target}` : target;
}

export function startBroadcastHold(target: string, priority: boolean): void {
  const state = useApp.getState();
  const me = state.me;
  if (!me || !state.voice.channelId) return;
  if (!hasPermission(state.me, state.roles, 'broadcast')) return;
  const key = holdKey(target, priority);
  if (heldBroadcastTargets.has(key)) return;
  if (heldBroadcastTargets.size === 0) {
    broadcastHold = {
      all: me.broadcastAll,
      groupIds: [...me.broadcastGroupIds],
      priority: me.broadcastPriority,
    };
  }
  heldBroadcastTargets.add(key);
  if (target === 'all') {
    setBroadcastTargets({ all: true, groupIds: [...me.broadcastGroupIds], priority });
    return;
  }
  setBroadcastTargets({
    all: me.broadcastAll,
    groupIds: me.broadcastGroupIds.includes(target)
      ? [...me.broadcastGroupIds]
      : [...me.broadcastGroupIds, target],
    priority,
  });
}

export function endBroadcastHold(target: string, priority: boolean): void {
  if (!heldBroadcastTargets.delete(holdKey(target, priority))) return;
  if (heldBroadcastTargets.size > 0) return;
  releaseBroadcastHolds();
}

export function releaseBroadcastHolds(): void {
  if (heldBroadcastTargets.size === 0 && !broadcastHold) return;
  heldBroadcastTargets.clear();
  const snapshot = broadcastHold;
  broadcastHold = null;
  if (!snapshot || !useApp.getState().voice.channelId) return;
  setBroadcastTargets(snapshot);
}

export function toggleScreenShare(): void {
  if (useApp.getState().voice.localScreen) void voice.stopScreenShare();
  else void voice.startScreenShare();
}

export function sendChatMessage(channelId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const socket = getSocket();
  if (!socket?.connected) {
    toast('error', 'Нет соединения с сервером');
    return;
  }
  socket.emit('chat:send', { channelId, text: trimmed }, (result) => {
    if (!result.ok) toast('error', result.error ?? 'Сообщение не отправлено');
  });
}

let settingsTimer: number | undefined;

export function updateSettings(patch: Partial<MicSettings>): void {
  useApp.getState().setSettings(patch);
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    void voice.applySettings(useApp.getState().settings);
  }, 250);
}

export function openScreenViewer(sessionId: string): void {
  useApp.getState().setViewer(sessionId);
}

export function closeScreenViewer(): void {
  useApp.getState().setViewer(null);
}
