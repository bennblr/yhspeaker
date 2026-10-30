import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, LogOut, MicOff, ShieldCheck, Tag, UserCheck } from 'lucide-react';
import {
  hasPermission,
  type BaseRole,
  type OnlineUser,
  type Role,
} from '@tsds/shared';
import { Avatar } from './Avatar';
import { DeviceBadge } from './DeviceBadge';
import { LabelBadge } from './LabelBadge';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';
import { BASE_ROLE_META } from '../lib/roles';
import { toast } from '../lib/actions';
import { getSocket } from '../lib/socket';

// Одно меню участника и для громкости, и для действий модератора: раньше это
// были два разных всплывающих окна на одну и ту же карточку.
export function UserMenu({
  user,
  anchor,
  canModerate,
  onClose,
}: {
  user: OnlineUser;
  anchor: HTMLElement | null;
  canModerate: boolean;
  onClose: () => void;
}) {
  const me = useApp((state) => state.me);
  const channels = useApp((state) => state.channels);
  const roles = useApp((state) => state.roles);
  const volume = useApp((state) => state.userVolumes[user.id] ?? 1);
  const setUserVolume = useApp((state) => state.setUserVolume);
  const localMuted = useApp((state) => state.localMuted.includes(user.id));
  const toggleLocalMute = useApp((state) => state.toggleLocalMute);
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

  if (!anchor) return null;

  const meRole = me?.role;
  const canModerateUser = canModerate && Boolean(me) && me?.id !== user.id;
  const voiceChannels = channels.filter(
    (channel) => channel.type === 'voice' && channel.id !== user.channelId,
  );
  const canAssignBaseRole = canModerateUser && meRole === 'admin' && !user.isGuest;
  const canPromoteGuest =
    canModerateUser && meRole === 'moderator' && !user.isGuest && user.role === 'guest';
  const canAuthorizeGuest =
    canModerateUser && user.isGuest && (meRole === 'admin' || meRole === 'moderator');
  const canManageRoles =
    canModerateUser && !user.isGuest && hasPermission(me, roles, 'roles');

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

  function toggleCustomRole(role: Role, client: NonNullable<typeof socket>): void {
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

  function authorizeGuest(client: NonNullable<typeof socket>): void {
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
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">
            {user.displayName}
          </span>
          <LabelBadge label={user.label} />
          <DeviceBadge device={user.device} deviceName={user.deviceName} className="ml-auto" />
        </div>

        <div className="rounded-lg px-2.5 pb-2 pt-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            <span>Громкость</span>
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
            className="mt-2 w-full"
            aria-label="Громкость участника"
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-muted">
            <span>тише</span>
            <span>обычно</span>
            <span>громче</span>
          </div>
          <div className="mt-2 flex gap-1.5">
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
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
            Настройка действует только на этом устройстве и только для вас.
          </p>
        </div>

        {socket && canModerateUser && (
          <div className="mt-1 border-t border-line pt-1">
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
                    socket.emit(
                      'mod:kick',
                      { userId: user.id, sessionId: user.sessionId },
                      callback,
                    ),
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
                onClick={() => authorizeGuest(socket)}
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
                        onChange={() => toggleCustomRole(role, socket)}
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
                  if (!window.confirm(`Забанить ${user.displayName}? Аккаунт не сможет войти.`)) {
                    return;
                  }
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
        )}
      </div>
    </>,
    document.body,
  );
}
