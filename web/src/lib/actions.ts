import { useApp } from './store';
import { getSocket, disconnectSocket } from './socket';
import { voice } from './voice';
import type { MicSettings } from './settings';
import { hasPermission, type Channel } from '@tsds/shared';

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

export function setBroadcastTargets(
  targets: { all: boolean; groupIds: string[] },
  successText?: string,
): void {
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

export function toggleBroadcastAll(): void {
  const state = useApp.getState();
  const me = state.me;
  if (!me) return;
  const all = !me.broadcastAll;
  const groupIds = me.broadcastGroupIds;
  let message: string;
  if (all) message = 'Вещание включено во все голосовые каналы';
  else if (groupIds.length > 0) message = 'Вещание во все каналы выключено, группы остались';
  else message = 'Вещание остановлено';
  setBroadcastTargets({ all, groupIds }, message);
}

export function toggleBroadcastGroup(groupId: string): void {
  const state = useApp.getState();
  const me = state.me;
  if (!me) return;
  const group = state.broadcastGroups.find((item) => item.id === groupId);
  if (!group) return;
  const active = me.broadcastGroupIds.includes(groupId);
  const groupIds = active
    ? me.broadcastGroupIds.filter((id) => id !== groupId)
    : [...me.broadcastGroupIds, groupId];
  let message: string;
  if (!active) message = `Вещание включено для группы «${group.name}»`;
  else if (me.broadcastAll || groupIds.length > 0) message = `Группа «${group.name}» убрана из вещания`;
  else message = 'Вещание остановлено';
  setBroadcastTargets({ all: me.broadcastAll, groupIds }, message);
}

export function stopBroadcast(): void {
  const me = useApp.getState().me;
  if (!me) return;
  setBroadcastTargets({ all: false, groupIds: [] }, 'Вещание остановлено');
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

export function openScreenViewer(userId: string): void {
  useApp.getState().setViewer(userId);
}

export function closeScreenViewer(): void {
  useApp.getState().setViewer(null);
}
