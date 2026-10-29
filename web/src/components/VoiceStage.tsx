import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  HeadphoneOff,
  Loader2,
  LogOut,
  MicOff,
  MonitorUp,
  MoreVertical,
  Radio,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  UserCheck,
  UserX,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  hasPermission,
  type BaseRole,
  type BroadcastGroup,
  type Channel,
  type OnlineUser,
  type Role,
} from '@tsds/shared';
import { Avatar } from './Avatar';
import { DeviceBadge } from './DeviceBadge';
import { LabelBadge } from './LabelBadge';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';
import { BASE_ROLE_META, primaryRole, roleLabel } from '../lib/roles';
import {
  leaveVoice,
  joinVoice,
  openScreenViewer,
  stopBroadcast,
  toggleScreenShare,
  toast,
} from '../lib/actions';
import { getSocket } from '../lib/socket';

function VideoPreview({ stream, muted = true }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />;
}

function ModeratorMenu({
  user,
  anchor,
  onClose,
}: {
  user: OnlineUser;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const me = useApp((state) => state.me);
  const channels = useApp((state) => state.channels);
  const roles = useApp((state) => state.roles);
  const socket = getSocket();
  const [selectedRoles, setSelectedRoles] = useState<string[]>(user.roleIds);

  useEffect(() => {
    setSelectedRoles(user.roleIds);
  }, [user.roleIds]);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  if (!socket || !me || !anchor) return null;

  const client = socket;
  const voiceChannels = channels.filter(
    (channel) => channel.type === 'voice' && channel.id !== user.channelId,
  );
  const canAssignBaseRole = me.role === 'admin' && !user.isGuest;
  const canPromoteGuest = me.role === 'moderator' && !user.isGuest && user.role === 'guest';
  const canAuthorizeGuest =
    user.isGuest && (me.role === 'admin' || me.role === 'moderator');
  const canManageRoles = !user.isGuest && hasPermission(me, roles, 'roles');

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(272, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 240));
  const maxHeight = Math.max(180, window.innerHeight - top - 8);

  function run(
    emit: (callback: (result: { ok: boolean; error?: string }) => void) => void,
  ): void {
    emit((result) => {
      onClose();
      if (!result.ok) toast('error', result.error ?? 'Не удалось выполнить действие');
    });
  }

  function toggleCustomRole(role: Role): void {
    const next = selectedRoles.includes(role.id)
      ? selectedRoles.filter((id) => id !== role.id)
      : [...selectedRoles, role.id];
    setSelectedRoles(next);
    client.emit('mod:setUserRoles', { userId: user.id, roleIds: next }, (result) => {
      if (result.ok) return;
      setSelectedRoles(user.roleIds);
      toast('error', result.error ?? 'Не удалось изменить роли');
    });
  }

  function authorizeGuest(): void {
    if (
      !window.confirm(
        `Назначить ${user.displayName} роль Пользователь? Аккаунт сохранится в «Аккаунтах».`,
      )
    ) {
      return;
    }
    client.emit('mod:authorizeGuest', { userId: user.id }, (result) => {
      onClose();
      if (!result.ok) {
        toast('error', result.error ?? 'Не удалось авторизовать гостя');
        return;
      }
      toast('ok', 'Назначена роль Пользователь');
      window.prompt(
        'Гость стал пользователем. Логин и пароль:',
        `Логин: ${result.username} · Пароль: ${result.password}`,
      );
    });
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] cursor-default"
        onClick={onClose}
        aria-label="Закрыть меню"
      />
      <div
        className="fixed z-[70] animate-rise overflow-y-auto rounded-xl border border-line bg-[#0b0e15] p-1.5 text-left shadow-panel"
        style={{ left, top, width, maxHeight }}
      >
        <div className="flex items-center gap-2 px-2.5 py-2">
          <Avatar id={user.id} name={user.displayName} size="xs" />
          <span className="truncate text-xs font-semibold text-slate-200">
            {user.displayName}
          </span>
          <LabelBadge label={user.label} />
          <DeviceBadge device={user.device} deviceName={user.deviceName} className="ml-auto" />
        </div>
        <div className="my-1 h-px bg-line" />
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-panel3"
          onClick={() => {
            const next = window.prompt(
              'Метка рядом с ником (до 20 символов, пусто — убрать):',
              user.label ?? '',
            );
            if (next === null) return;
            run((callback) =>
              socket.emit('mod:setLabel', { userId: user.id, label: next }, callback),
            );
          }}
        >
          <Tag className="h-3.5 w-3.5 text-accent" />
          {user.label ? 'Изменить метку' : 'Подписать участника'}
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-panel3"
          onClick={() =>
            run((callback) =>
              socket.emit(
                'mod:serverMute',
                { userId: user.id, muted: !user.serverMuted },
                callback,
              ),
            )
          }
        >
          <MicOff className="h-3.5 w-3.5 text-warn" />
          {user.serverMuted ? 'Вернуть микрофон' : 'Отключить микрофон'}
        </button>
        {user.channelId && voiceChannels.length > 0 && (
          <div className="px-2.5 py-1.5">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Переместить в канал
            </div>
            <select
              className="input h-8 py-0 text-xs"
              value=""
              onChange={(event) => {
                const channelId = event.target.value;
                if (!channelId) return;
                run((callback) =>
                  socket.emit(
                    'mod:moveUser',
                    { userId: user.id, sessionId: user.sessionId, channelId },
                    callback,
                  ),
                );
              }}
            >
              <option value="">Выберите канал…</option>
              {voiceChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {user.channelId && (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-panel3"
            onClick={() =>
              run((callback) =>
                socket.emit('mod:kick', { userId: user.id, sessionId: user.sessionId }, callback),
              )
            }
          >
            <LogOut className="h-3.5 w-3.5 text-warn" />
            Выгнать из канала
          </button>
        )}
        {canAssignBaseRole && (
          <div className="mt-1 border-t border-line px-2.5 pb-1 pt-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Базовая роль
            </div>
            <select
              className="input h-8 py-0 text-xs"
              value={user.role}
              onChange={(event) => {
                const role = event.target.value as BaseRole;
                if (role === user.role) return;
                run((callback) =>
                  socket.emit('mod:setRole', { userId: user.id, role }, callback),
                );
              }}
            >
              {BASE_ROLE_META.map((meta) => (
                <option key={meta.key} value={meta.key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {canAuthorizeGuest && (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-panel3"
            onClick={authorizeGuest}
          >
            <UserCheck className="h-3.5 w-3.5 text-ok" />
            Сделать пользователем
          </button>
        )}
        {canPromoteGuest && (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-panel3"
            onClick={() =>
              run((callback) =>
                socket.emit('mod:setRole', { userId: user.id, role: 'member' }, callback),
              )
            }
          >
            <ShieldCheck className="h-3.5 w-3.5 text-ok" />
            Назначить пользователем
          </button>
        )}
        {canManageRoles && roles.length > 0 && (
          <div className="mt-1 border-t border-line px-2.5 pb-1 pt-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Пользовательские роли
            </div>
            <div className="max-h-28 space-y-0.5 overflow-y-auto">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-slate-300 transition hover:bg-panel3"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 accent-accent"
                    checked={selectedRoles.includes(role.id)}
                    onChange={() => toggleCustomRole(role)}
                  />
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{role.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {!user.isGuest && user.role !== 'admin' && (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-danger/10"
            onClick={() => {
              if (!window.confirm(`Забанить ${user.displayName}? Аккаунт не сможет войти.`)) return;
              run((callback) =>
                socket.emit('mod:ban', { userId: user.id, banned: true }, callback),
              );
            }}
          >
            <Ban className="h-3.5 w-3.5" />
            Забанить
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

function VolumeMenu({
  user,
  anchor,
  onClose,
}: {
  user: OnlineUser;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const volume = useApp((state) => state.userVolumes[user.id] ?? 1);
  const setUserVolume = useApp((state) => state.setUserVolume);
  const localMuted = useApp((state) => state.localMuted.includes(user.id));
  const toggleLocalMute = useApp((state) => state.toggleLocalMute);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  if (!anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(240, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 200));

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] cursor-default"
        onClick={onClose}
        aria-label="Закрыть"
      />
      <div
        className="fixed z-[70] animate-rise rounded-xl border border-line bg-[#0b0e15] p-3 text-left shadow-panel"
        style={{ left, top, width }}
      >
        <div className="flex items-center gap-2">
          <Avatar id={user.id} name={user.displayName} size="xs" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">
            {user.displayName}
          </span>
          <span className="text-[11px] font-semibold text-slate-200">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(event) => setUserVolume(user.id, Number(event.target.value) / 100)}
          className="mt-3 w-full"
          aria-label="Громкость участника"
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>тише</span>
          <span>обычно</span>
          <span>громче</span>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            className="btn-ghost h-7 flex-1 px-2 text-[11px]"
            onClick={() => setUserVolume(user.id, 1)}
          >
            100%
          </button>
          <button
            type="button"
            className={cn(
              'btn-ghost h-7 flex-1 px-2 text-[11px]',
              localMuted && 'text-danger',
            )}
            onClick={() => toggleLocalMute(user.id)}
          >
            {localMuted ? 'Включить звук' : 'Заглушить'}
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          Настройка действует только на этом устройстве и только для вас.
        </p>
      </div>
    </>,
    document.body,
  );
}

function ParticipantTile({
  user,
  speaking,
  isSelf,
  canModerate,
}: {
  user: OnlineUser;
  speaking: boolean;
  isSelf: boolean;
  canModerate: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const groups = useApp((state) => state.broadcastGroups);
  const roles = useApp((state) => state.roles);
  const localMuted = useApp((state) => state.localMuted.includes(user.id));
  const volume = useApp((state) => state.userVolumes[user.id] ?? 1);
  const toggleLocalMute = useApp((state) => state.toggleLocalMute);
  const primary = user.role === 'member' ? primaryRole(user, roles) : null;
  const showModMenu = canModerate && !isSelf;

  return (
    <div
      className={cn(
        'relative flex min-h-[156px] flex-col items-center justify-center gap-3 rounded-2xl border bg-panel2/80 p-4 transition',
        speaking ? 'border-ok/40 bg-ok/[0.05]' : 'border-line hover:border-line/80',
      )}
    >
      <div className="absolute left-2 top-2 flex items-center gap-1">
        {user.broadcasting && (
          <span
            className="flex items-center gap-1 rounded-full bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ok"
            title={`Эфир: ${broadcastAudience(user, groups)}`}
          >
            <Radio className="h-2.5 w-2.5" /> эфир
          </span>
        )}
      </div>
      {showModMenu && (
        <div className="absolute right-1.5 top-1.5">
          <button
            ref={menuButtonRef}
            className="icon-btn h-7 w-7 opacity-60 hover:opacity-100"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Действия"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <ModeratorMenu
              user={user}
              anchor={menuButtonRef.current}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      )}

      <Avatar id={user.id} name={user.displayName} size="lg" speaking={speaking} />

      <div className="w-full text-center">
        <div className="flex items-center justify-center gap-1.5">
          <span
            className={cn(
              'max-w-full truncate text-sm font-semibold text-slate-100',
              localMuted && 'opacity-50',
            )}
            style={primary ? { color: primary.color } : undefined}
          >
            {user.displayName}
          </span>
          <LabelBadge label={user.label} />
          {user.role === 'admin' && (
            <span title="Администратор" className="shrink-0">
              <Shield className="h-3.5 w-3.5 text-accent" />
            </span>
          )}
          {user.role === 'moderator' && (
            <span title="Модератор" className="shrink-0">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" />
            </span>
          )}
          {isSelf && (
            <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-medium text-slate-300">
              вы
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          {primary && (
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: primary.color }}
            />
          )}
          {roleLabel(user, roles)}
        </div>
        <div className="mt-1 flex justify-center">
          <DeviceBadge device={user.device} deviceName={user.deviceName} />
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-muted">
        {user.serverMuted && (
          <span title="Микрофон отключён администратором">
            <MicOff className="h-3.5 w-3.5 text-danger" />
          </span>
        )}
        {!user.serverMuted && user.muted && (
          <span title="Микрофон выключен">
            <MicOff className="h-3.5 w-3.5" />
          </span>
        )}
        {user.deafened && (
          <span title="Звук выключен">
            <HeadphoneOff className="h-3.5 w-3.5 text-danger/80" />
          </span>
        )}
        {user.screenSharing && (
          <span title="Демонстрирует экран">
            <MonitorUp className="h-3.5 w-3.5 text-accent" />
          </span>
        )}
        {speaking && <span className="text-[10px] font-medium text-ok">говорит</span>}
        {!isSelf && (
          <>
            {volume !== 1 && (
              <span
                className="rounded bg-accent/10 px-1 text-[10px] font-semibold text-accent"
                title="Ваша громкость этого участника"
              >
                {Math.round(volume * 100)}%
              </span>
            )}
            <button
              ref={volumeButtonRef}
              type="button"
              className={cn(
                'ml-1 rounded p-0.5 transition hover:bg-white/[0.06]',
                volume !== 1 && 'text-accent',
              )}
              title={`Громкость участника (${Math.round(volume * 100)}%)`}
              onClick={() => setVolumeOpen((value) => !value)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={cn(
                'rounded p-0.5 transition hover:bg-white/[0.06]',
                localMuted && 'text-danger',
              )}
              title={localMuted ? 'Включить звук участника у себя' : 'Заглушить участника у себя'}
              onClick={() => toggleLocalMute(user.id)}
            >
              {localMuted ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        )}
      </div>
      {volumeOpen && (
        <VolumeMenu user={user} anchor={volumeButtonRef.current} onClose={() => setVolumeOpen(false)} />
      )}
    </div>
  );
}

function broadcastAudience(user: OnlineUser, groups: BroadcastGroup[]): string {
  if (user.broadcastAll) return 'все голосовые каналы';
  const names = groups
    .filter((group) => user.broadcastGroupIds.includes(group.id))
    .map((group) => `«${group.name}»`);
  if (names.length === 0) return 'без слушателей';
  return names.length === 1 ? `группа ${names[0]}` : `группы ${names.join(', ')}`;
}

export function BroadcastBanner() {
  const users = useApp((state) => state.users);
  const me = useApp((state) => state.me);
  const groups = useApp((state) => state.broadcastGroups);
  const broadcasters = users.filter((user) => user.broadcasting);

  if (broadcasters.length === 0) return null;
  const self = broadcasters.find((user) => user.id === me?.id);
  const others = broadcasters.filter((user) => user.id !== me?.id);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ok/20 bg-gradient-to-r from-ok/[0.09] via-ok/[0.05] to-transparent px-5 py-2.5">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
      </span>
      <Radio className="h-4 w-4 shrink-0 text-ok" />
      <div className="min-w-0 flex-1 text-xs text-slate-300">
        {self && (
          <span className="font-semibold text-ok">
            Вы вещаете: {broadcastAudience(self, groups)}
          </span>
        )}
        {self && others.length > 0 && <span className="mx-1.5 text-muted">·</span>}
        {others.length > 0 && (
          <span>
            <span className="font-semibold text-ok">
              {others.map((user) => user.displayName).join(', ')}
            </span>{' '}
            {others.length === 1 ? 'вещает' : 'вещают'}:{' '}
            {others.map((user) => broadcastAudience(user, groups)).join('; ')}
          </span>
        )}
      </div>
      {self && (
        <button className="btn-ghost h-7 px-2.5 text-xs" onClick={stopBroadcast}>
          Остановить
        </button>
      )}
    </div>
  );
}

export function VoiceStage({ channel }: { channel: Channel }) {
  const users = useApp((state) => state.users);
  const me = useApp((state) => state.me);
  const speaking = useApp((state) => state.speaking);
  const voice = useApp((state) => state.voice);
  const screens = useApp((state) => state.voice.remoteScreens);
  const roles = useApp((state) => state.roles);

  const canModerate = hasPermission(me, roles, 'moderate');
  const canBroadcast = hasPermission(me, roles, 'broadcast');
  const channelUsers = users.filter((user) => user.channelId === channel.id);
  const connected = voice.channelId === channel.id;
  const connecting = voice.connecting && voice.channelId === channel.id;
  const speakingSet = new Set(speaking);
  const localScreen = voice.localScreen;

  const screenCards = [
    ...(localScreen
      ? [
          {
            sessionId: me?.sessionId ?? 'self',
            name: 'Ваш экран',
            stream: localScreen,
            local: true,
          },
        ]
      : []),
    ...Object.entries(screens).map(([sessionId, stream]) => ({
      sessionId,
      name: users.find((user) => user.sessionId === sessionId)?.displayName ?? 'Участник',
      stream,
      local: false,
    })),
  ];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      {screenCards.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            <MonitorUp className="h-3.5 w-3.5" />
            Демонстрация экрана
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {screenCards.map((card) => (
              <div
                key={card.sessionId}
                className="group relative w-[300px] shrink-0 overflow-hidden rounded-xl border border-line bg-black/50"
              >
                <div className="aspect-video">
                  <VideoPreview stream={card.stream} />
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-6">
                  <span className="truncate text-xs font-medium text-slate-200">{card.name}</span>
                  {card.local ? (
                    <button
                      className="rounded-md bg-black/50 px-2 py-1 text-[10px] text-slate-200 hover:bg-black/70"
                      onClick={toggleScreenShare}
                    >
                      Остановить
                    </button>
                  ) : (
                    <button
                      className="rounded-md bg-accent/90 px-2 py-1 text-[10px] font-medium text-white hover:bg-accent"
                      onClick={() => openScreenViewer(card.sessionId)}
                    >
                      Смотреть
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!connected ? (
        <div className="relative flex min-h-[360px] flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-[#121623] via-panel2 to-[#0e111a] px-6 py-10 text-center">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/15 blur-[80px]" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-line bg-panel3 shadow-glow">
            <Volume2 className="h-9 w-9 text-accent" />
          </div>
          <div className="relative">
            <h2 className="text-xl font-bold text-white">{channel.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {channelUsers.length === 0
                ? 'В канале пока никого нет'
                : `Сейчас в канале: ${channelUsers.length}`}
            </p>
          </div>
          {channelUsers.length > 0 && (
            <div className="relative flex flex-wrap justify-center gap-2">
              {channelUsers.map((user) => (
                <div
                  key={user.sessionId}
                  className="flex items-center gap-2 rounded-full border border-line bg-panel/80 py-1 pl-1 pr-3"
                >
                  <Avatar id={user.id} name={user.displayName} size="xs" />
                  <span className="text-xs text-slate-300">{user.displayName}</span>
                  <DeviceBadge device={user.device} deviceName={user.deviceName} compact />
                </div>
              ))}
            </div>
          )}
          <button
            className="btn-primary relative h-11 px-6"
            onClick={() => void joinVoice(channel.id)}
          >
            <Volume2 className="h-4 w-4" />
            Присоединиться к каналу
          </button>
          <p className="relative max-w-sm text-[11px] leading-relaxed text-muted">
            При первом подключении браузер попросит доступ к микрофону. Вы сможете войти и без
            него — в режиме слушателя.
          </p>
        </div>
      ) : connecting ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-panel2">
          <Loader2 className="h-7 w-7 animate-spin text-accent" />
          <p className="text-sm text-slate-300">Подключаемся к каналу…</p>
          <p className="text-[11px] text-muted">Создаём WebRTC-соединение</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-ok/25 bg-ok/[0.07] px-3 py-1.5 text-xs font-medium text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              Подключено к «{channel.name}»
            </div>
            <button className="btn-ghost h-8 px-3 text-xs" onClick={toggleScreenShare}>
              <MonitorUp className="h-3.5 w-3.5" />
              {voice.localScreen ? 'Остановить показ' : 'Показать экран'}
            </button>
            {canBroadcast && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Radio className="h-3.5 w-3.5" />
                вещание включается клавишами из настроек
              </span>
            )}
            <button className="btn-ghost ml-auto h-8 px-3 text-xs" onClick={leaveVoice}>
              <LogOut className="h-3.5 w-3.5" />
              Отключиться
            </button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {channelUsers.map((user) => (
              <ParticipantTile
                key={user.sessionId}
                user={user}
                speaking={speakingSet.has(user.sessionId)}
                isSelf={user.sessionId === me?.sessionId}
                canModerate={canModerate}
              />
            ))}
            {channelUsers.length === 0 && (
              <div className="col-span-full flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-muted">
                <UserX className="h-6 w-6" />
                <p className="text-xs">Вы одни в канале</p>
              </div>
            )}
          </div>
        </div>
      )}

      {connected && (
        <p className="flex items-center gap-1.5 text-[10px] text-muted">
          <X className="h-3 w-3" />
          Выход из канала доступен кнопкой «Отключиться» — вы останетесь на сервере и в чате.
        </p>
      )}
    </div>
  );
}
