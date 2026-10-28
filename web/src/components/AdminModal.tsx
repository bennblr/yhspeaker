import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  BarChart3,
  Check,
  Copy,
  Hash,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Palette,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Shield,
  ShieldCheck,
  Tag,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Volume2,
} from 'lucide-react';
import {
  BASE_ROLES,
  MAX_GROUP_NAME,
  MAX_ROLE_NAME,
  NO_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  type AdminUser,
  type BaseRole,
  type BroadcastGroup,
  type Channel,
  type ChannelType,
  type OnlineUser,
  type OnlineStatsSummary,
  type Role,
  type RolePermissions,
} from '@tsds/shared';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { LabelBadge } from './LabelBadge';
import { api, type InviteSettings } from '../lib/api';
import { useApp } from '../lib/store';
import { getSocket } from '../lib/socket';
import { toast } from '../lib/actions';
import { BASE_ROLE_META, PERMISSION_META, ROLE_COLORS, roleColor, roleLabel, userRoleList } from '../lib/roles';
import { cn, formatDate } from '../lib/utils';

type Tab = 'channels' | 'roles' | 'groups' | 'online' | 'accounts' | 'stats' | 'invite';

const TABS: { id: Tab; label: string }[] = [
  { id: 'channels', label: 'Каналы' },
  { id: 'roles', label: 'Роли' },
  { id: 'groups', label: 'Группы' },
  { id: 'online', label: 'В сети' },
  { id: 'accounts', label: 'Аккаунты' },
  { id: 'stats', label: 'Статистика' },
  { id: 'invite', label: 'Приглашение' },
];

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${total} с`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('ok', 'Скопировано в буфер обмена');
  } catch {
    window.prompt('Скопируйте значение:', text);
  }
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-8 text-center text-xs text-muted">{text}</p>;
}

export function AdminModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const token = useApp((state) => state.token);
  const me = useApp((state) => state.me);
  const users = useApp((state) => state.users);
  const channels = useApp((state) => state.channels);
  const groups = useApp((state) => state.broadcastGroups);
  const roles = useApp((state) => state.roles);
  const [tab, setTab] = useState<Tab>('channels');
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('voice');
  const [channelPassword, setChannelPassword] = useState('');
  const [removeChannelPassword, setRemoveChannelPassword] = useState(false);
  const [guestVisible, setGuestVisible] = useState(true);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [channelBusy, setChannelBusy] = useState(false);
  const [accounts, setAccounts] = useState<AdminUser[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteSettings | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState(ROLE_COLORS[0]);
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>({ ...NO_PERMISSIONS });
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [stats, setStats] = useState<OnlineStatsSummary | null>(null);
  const [statsOnline, setStatsOnline] = useState(0);
  const [statsDays, setStatsDays] = useState(7);
  const [statsLoading, setStatsLoading] = useState(false);

  const canChannels = hasPermission(me, roles, 'channels');
  const canRoles = hasPermission(me, roles, 'roles');
  const canGroups = hasPermission(me, roles, 'groups');
  const canModerate = hasPermission(me, roles, 'moderate');
  const canInvite = hasPermission(me, roles, 'invite');
  const canSeeAccounts = canModerate || canRoles || canGroups;
  const isAdmin = me?.role === 'admin';
  const isModerator = me?.role === 'moderator';
  const guestLink = invite
    ? `${window.location.origin}/?guest=${encodeURIComponent(invite.code)}`
    : '';
  const editingChannel = editingChannelId
    ? (channels.find((channel) => channel.id === editingChannelId) ?? null)
    : null;
  const passwordLocked = Boolean(editingChannel?.guest);

  const allowedTabs = TABS.filter((item) => {
    if (item.id === 'channels') return canChannels;
    if (item.id === 'roles') return canRoles;
    if (item.id === 'groups') return canGroups;
    if (item.id === 'online') return canModerate;
    if (item.id === 'accounts') return canSeeAccounts;
    if (item.id === 'stats') return canModerate;
    return canInvite;
  });

  const loadAccounts = useCallback(async () => {
    if (!token) return;
    try {
      const result = await api.adminUsers(token);
      setAccounts(result.users);
      setAccountsError(null);
    } catch (error) {
      setAccountsError(error instanceof Error ? error.message : 'Не удалось загрузить аккаунты');
    }
  }, [token]);

  const loadInvite = useCallback(async () => {
    if (!token) return;
    try {
      setInvite(await api.adminInvite(token));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Не удалось получить код');
    }
  }, [token]);

  const loadStats = useCallback(async (days: number) => {
    if (!token) return;
    setStatsLoading(true);
    try {
      const result = await api.adminStats(token, days);
      setStats(result.stats);
      setStatsOnline(result.online);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Не удалось загрузить статистику');
    } finally {
      setStatsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!open || tab !== 'stats') return;
    void loadStats(statsDays);
  }, [open, tab, statsDays, loadStats]);

  useEffect(() => {
    if (!open) return;
    if (canSeeAccounts) void loadAccounts();
    if (canInvite) void loadInvite();
  }, [open, canSeeAccounts, canInvite, loadAccounts, loadInvite]);

  useEffect(() => {
    if (!open) return;
    if (allowedTabs.some((item) => item.id === tab)) return;
    if (allowedTabs[0]) setTab(allowedTabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, canChannels, canRoles, canGroups, canModerate, canSeeAccounts, canInvite]);

  useEffect(() => {
    if (!open) {
      setTab('channels');
      setName('');
      setType('voice');
      setChannelPassword('');
      setRemoveChannelPassword(false);
      setGuestVisible(true);
      setEditingChannelId(null);
      setChannelBusy(false);
      setBusyKey(null);
      setEditingGroupId(null);
      setGroupName('');
      setGroupMembers([]);
      setEditingRoleId(null);
      setRoleName('');
      setRoleColor(ROLE_COLORS[0]);
      setRolePermissions({ ...NO_PERMISSIONS });
    }
  }, [open]);

  if (!me || !hasAnyPermission(me, roles)) return null;

  function resetChannelForm(): void {
    setName('');
    setType('voice');
    setChannelPassword('');
    setRemoveChannelPassword(false);
    setGuestVisible(true);
    setEditingChannelId(null);
  }

  function editChannel(channel: Channel): void {
    setEditingChannelId(channel.id);
    setName(channel.name);
    setType(channel.type);
    setChannelPassword('');
    setRemoveChannelPassword(false);
    setGuestVisible(channel.guest || channel.visibleRoles.includes('guest'));
  }

  function saveChannel() {
    const socket = getSocket();
    const value = name.trim();
    if (!socket || !value || channelBusy) return;
    setChannelBusy(true);
    const password: string | undefined = passwordLocked
      ? undefined
      : removeChannelPassword
        ? ''
        : channelPassword.trim()
          ? channelPassword.trim()
          : undefined;
    const done = (result: { ok: boolean; error?: string }) => {
      setChannelBusy(false);
      if (!result.ok) {
        toast('error', result.error ?? 'Не удалось сохранить канал');
        return;
      }
      const wasEditing = Boolean(editingChannelId);
      resetChannelForm();
      toast('ok', wasEditing ? `Канал «${value}» обновлён` : `Канал «${value}» создан`);
    };
    const visibility = passwordLocked
      ? { visibleRoles: [...BASE_ROLES], visibleRoleIds: [] }
      : {
          visibleRoles: guestVisible
            ? [...BASE_ROLES]
            : (['member', 'moderator', 'admin'] as BaseRole[]),
          visibleRoleIds: [],
        };
    if (editingChannelId) {
      socket.emit(
        'admin:updateChannel',
        { channelId: editingChannelId, name: value, password, ...visibility },
        done,
      );
    } else {
      socket.emit('admin:createChannel', { name: value, type, password, ...visibility }, done);
    }
  }

  function deleteChannel(channelId: string) {
    const socket = getSocket();
    const channel = channels.find((item) => item.id === channelId);
    if (!socket || !channel) return;
    if (
      !window.confirm(
        `Удалить канал «${channel.name}»? Все сообщения канала будут потеряны, а участники отключены.`,
      )
    ) {
      return;
    }
    socket.emit('admin:deleteChannel', { channelId }, (result) => {
      if (!result.ok) toast('error', result.error ?? 'Не удалось удалить канал');
    });
  }

  function runMod(
    key: string,
    emit: (callback: (result: { ok: boolean; error?: string }) => void) => void,
  ): void {
    if (busyKey) return;
    setBusyKey(key);
    emit((result) => {
      setBusyKey(null);
      if (!result.ok) {
        toast('error', result.error ?? 'Не удалось выполнить действие');
        return;
      }
      void loadAccounts();
    });
  }

  function regenerate() {
    if (!token || inviteBusy) return;
    if (!window.confirm('Старый код приглашения перестанет работать. Создать новый?')) return;
    setInviteBusy(true);
    api
      .regenerateInvite(token)
      .then((result) => {
        setInvite((current) => ({
          code: result.code,
          allowGuests: current?.allowGuests ?? true,
          inviteRequired: current?.inviteRequired ?? false,
        }));
        toast('ok', 'Код приглашения обновлён');
      })
      .catch((error: unknown) => {
        toast('error', error instanceof Error ? error.message : 'Не удалось обновить код');
      })
      .finally(() => setInviteBusy(false));
  }

  function setInviteRequired(inviteRequired: boolean) {
    if (!token || inviteBusy) return;
    setInviteBusy(true);
    api
      .setInviteRequired(token, inviteRequired)
      .then((result) => {
        setInvite(result);
        toast(
          'ok',
          inviteRequired
            ? 'Гостям снова нужен код приглашения'
            : 'Гости могут входить только по нику',
        );
      })
      .catch((error: unknown) => {
        toast(
          'error',
          error instanceof Error ? error.message : 'Не удалось изменить режим гостевого входа',
        );
      })
      .finally(() => setInviteBusy(false));
  }

  function resetGroupForm(): void {
    setEditingGroupId(null);
    setGroupName('');
    setGroupMembers([]);
  }

  function editGroup(group: BroadcastGroup): void {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupMembers(group.memberIds);
  }

  function toggleGroupMember(accountId: string): void {
    setGroupMembers((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  }

  function saveGroup(): void {
    if (!token || groupBusy) return;
    const value = groupName.trim();
    if (!value) {
      toast('error', 'Введите название группы');
      return;
    }
    if (groupMembers.length === 0) {
      toast('error', 'Выберите хотя бы одного участника');
      return;
    }
    setGroupBusy(true);
    const request = editingGroupId
      ? api.updateGroup(token, editingGroupId, { name: value, memberIds: groupMembers })
      : api.createGroup(token, { name: value, memberIds: groupMembers });
    request
      .then((result) => {
        const current = useApp.getState().broadcastGroups;
        const next = current.some((group) => group.id === result.group.id)
          ? current.map((group) => (group.id === result.group.id ? result.group : group))
          : [...current, result.group];
        useApp.getState().setBroadcastGroups(next);
        toast('ok', editingGroupId ? 'Группа обновлена' : `Группа «${result.group.name}» создана`);
        resetGroupForm();
      })
      .catch((error: unknown) => {
        toast('error', error instanceof Error ? error.message : 'Не удалось сохранить группу');
      })
      .finally(() => setGroupBusy(false));
  }

  function deleteGroup(group: BroadcastGroup): void {
    if (!token || groupBusy) return;
    if (!window.confirm(`Удалить группу «${group.name}»?`)) return;
    setGroupBusy(true);
    api
      .deleteGroup(token, group.id)
      .then(() => {
        useApp
          .getState()
          .setBroadcastGroups(useApp.getState().broadcastGroups.filter((item) => item.id !== group.id));
        if (editingGroupId === group.id) resetGroupForm();
        toast('ok', `Группа «${group.name}» удалена`);
      })
      .catch((error: unknown) => {
        toast('error', error instanceof Error ? error.message : 'Не удалось удалить группу');
      })
      .finally(() => setGroupBusy(false));
  }

  function resetRoleForm(): void {
    setEditingRoleId(null);
    setRoleName('');
    setRoleColor(ROLE_COLORS[0]);
    setRolePermissions({ ...NO_PERMISSIONS });
  }

  function editRole(role: Role): void {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleColor(role.color);
    setRolePermissions({ ...role.permissions });
  }

  function togglePermission(key: keyof RolePermissions): void {
    setRolePermissions((current) => ({ ...current, [key]: !current[key] }));
  }

  function saveRole(): void {
    if (!token || roleBusy) return;
    const value = roleName.trim();
    if (value.length < 2) {
      toast('error', 'Название роли: минимум 2 символа');
      return;
    }
    setRoleBusy(true);
    const body = { name: value, color: roleColor, permissions: rolePermissions };
    const request = editingRoleId
      ? api.updateRole(token, editingRoleId, body)
      : api.createRole(token, body);
    request
      .then((result) => {
        const current = useApp.getState().roles;
        const next = current.some((role) => role.id === result.role.id)
          ? current.map((role) => (role.id === result.role.id ? result.role : role))
          : [...current, result.role];
        useApp.getState().setRoles(next);
        toast('ok', editingRoleId ? 'Роль обновлена' : `Роль «${result.role.name}» создана`);
        resetRoleForm();
      })
      .catch((error: unknown) => {
        toast('error', error instanceof Error ? error.message : 'Не удалось сохранить роль');
      })
      .finally(() => setRoleBusy(false));
  }

  function deleteRole(role: Role): void {
    if (!token || roleBusy) return;
    if (!window.confirm(`Удалить роль «${role.name}»? Она исчезнет у всех участников.`)) return;
    setRoleBusy(true);
    api
      .deleteRole(token, role.id)
      .then(() => {
        useApp
          .getState()
          .setRoles(useApp.getState().roles.filter((item) => item.id !== role.id));
        if (editingRoleId === role.id) resetRoleForm();
        void loadAccounts();
        toast('ok', `Роль «${role.name}» удалена`);
      })
      .catch((error: unknown) => {
        toast('error', error instanceof Error ? error.message : 'Не удалось удалить роль');
      })
      .finally(() => setRoleBusy(false));
  }

  const onlineIds = new Set(users.map((user) => user.id));

  function visibilityText(channel: Channel): string {
    if (channel.guest) return 'виден всем';
    return channel.visibleRoles.includes('guest') ? 'виден всем' : 'скрыт от гостей';
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Управление сервером"
      subtitle="Каналы, роли, участники, аккаунты и доступ гостей"
      width="max-w-3xl"
    >
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-line bg-panel p-1">
        {allowedTabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-xs font-medium transition',
              tab === item.id ? 'bg-accent text-white' : 'text-muted hover:text-slate-200',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'channels' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-panel/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              {editingChannelId ? (
                <Pencil className="h-4 w-4 text-accent" />
              ) : (
                <Plus className="h-4 w-4 text-accent" />
              )}
              {editingChannelId ? 'Изменить канал' : 'Новый канал'}
            </div>
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input flex-1"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveChannel();
                  }}
                  placeholder="Название канала"
                  maxLength={32}
                />
                <div
                  className={cn(
                    'flex rounded-lg border border-line bg-panel p-1',
                    editingChannelId && 'opacity-60',
                  )}
                >
                  {(['voice', 'text'] as ChannelType[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => setType(value)}
                      disabled={Boolean(editingChannelId)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                        type === value
                          ? 'bg-panel3 text-slate-100'
                          : 'text-muted hover:text-slate-200',
                      )}
                    >
                      {value === 'voice' ? (
                        <Volume2 className="h-3.5 w-3.5" />
                      ) : (
                        <Hash className="h-3.5 w-3.5" />
                      )}
                      {value === 'voice' ? 'Голосовой' : 'Текстовый'}
                    </button>
                  ))}
                </div>
                <button
                  className="btn-primary h-[42px] px-4"
                  disabled={!name.trim() || channelBusy}
                  onClick={saveChannel}
                >
                  {channelBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingChannelId ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {editingChannelId ? 'Сохранить' : 'Создать'}
                </button>
                {editingChannelId && (
                  <button
                    className="btn-ghost h-[42px] px-4 text-xs"
                    onClick={resetChannelForm}
                    disabled={channelBusy}
                  >
                    Отмена
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    className="input pl-9"
                    type="password"
                    value={channelPassword}
                    onChange={(event) => setChannelPassword(event.target.value)}
                    placeholder={
                      passwordLocked
                        ? 'Гостевой канал без пароля'
                        : editingChannelId
                          ? 'Новый пароль (пусто — не менять)'
                          : 'Пароль канала (необязательно)'
                    }
                    maxLength={64}
                    autoComplete="new-password"
                    disabled={passwordLocked || removeChannelPassword || channelBusy}
                  />
                </div>
                {editingChannel?.passwordProtected && !passwordLocked && (
                  <label className="flex items-center gap-2 text-[11px] text-muted">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#6c7cff]"
                      checked={removeChannelPassword}
                      onChange={(event) => {
                        setRemoveChannelPassword(event.target.checked);
                        if (event.target.checked) setChannelPassword('');
                      }}
                    />
                    Снять пароль
                  </label>
                )}
              </div>
              {passwordLocked && (
                <p className="text-[10px] text-muted">
                  Гостевой канал всегда открыт — пароль для него недоступен.
                </p>
              )}
              <div className="rounded-lg border border-line bg-panel/40 p-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Доступ гостей
                </span>
                <label
                  className={cn(
                    'mt-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 transition',
                    guestVisible || passwordLocked
                      ? 'border-accent/40 bg-accent/[0.07]'
                      : 'border-line bg-panel hover:bg-panel3',
                    passwordLocked && 'cursor-default opacity-80',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#6c7cff]"
                    checked={guestVisible || passwordLocked}
                    disabled={passwordLocked}
                    onChange={(event) => setGuestVisible(event.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-slate-200">
                      Виден гостям
                    </span>
                    <span className="block text-[10px] leading-snug text-muted">
                      Пользователи, модераторы и админы видят все каналы. Гостевой канал
                      открыт всем, его видимость не настраивается.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            {channels.map((channel) => {
              const count = users.filter((user) => user.channelId === channel.id).length;
              const Icon = channel.type === 'voice' ? Volume2 : Hash;
              return (
                <div
                  key={channel.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-panel/40 px-3 py-2.5"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm text-slate-200">{channel.name}</span>
                      {channel.guest && (
                        <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ok">
                          гостевой
                        </span>
                      )}
                      {channel.passwordProtected && (
                        <span
                          className="flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted"
                          title="Канал защищён паролем"
                        >
                          <Lock className="h-2.5 w-2.5" />
                          пароль
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      {channel.type === 'voice' ? 'голосовой' : 'текстовый'}
                      {channel.type === 'voice' && ` · ${count} в канале`}
                      {' · '}
                      {visibilityText(channel)}
                    </div>
                  </div>
                  <button
                    className={cn(
                      'icon-btn h-8 w-8',
                      editingChannelId === channel.id && 'icon-btn-active',
                    )}
                    onClick={() => editChannel(channel)}
                    title="Изменить название и пароль"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className={cn(
                      'icon-btn h-8 w-8 text-muted hover:bg-danger/15 hover:text-danger',
                      channel.guest && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted',
                    )}
                    onClick={() => deleteChannel(channel.id)}
                    disabled={channel.guest}
                    title={
                      channel.guest
                        ? 'Гостевой канал создаётся автоматически и не удаляется'
                        : 'Удалить канал'
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {channels.length === 0 && <Empty text="Каналов пока нет — создайте первый." />}
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-panel/40 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              <ShieldCheck className="h-4 w-4 text-accent" />
              Базовые роли
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {BASE_ROLE_META.map((meta) => (
                <div
                  key={meta.key}
                  className="rounded-lg border border-line bg-panel px-2.5 py-2"
                >
                  <div className="text-xs font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </div>
                  <div className="text-[10px] leading-snug text-muted">{meta.hint}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              Базовую роль назначает администратор во вкладке «Аккаунты». Модератор может выдать
              гостю только роль Пользователь.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-panel/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              {editingRoleId ? (
                <Pencil className="h-4 w-4 text-accent" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-accent" />
              )}
              {editingRoleId ? 'Изменить роль' : 'Новая роль'}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input flex-1"
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
                placeholder="Например: Модератор"
                maxLength={MAX_ROLE_NAME}
              />
              <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1.5">
                <Palette className="h-3.5 w-3.5 shrink-0 text-muted" />
                {ROLE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Цвет ${color}`}
                    onClick={() => setRoleColor(color)}
                    className={cn(
                      'h-4 w-4 rounded-full transition',
                      roleColor === color
                        ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-panel'
                        : 'opacity-80 hover:opacity-100',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {PERMISSION_META.map((permission) => {
                const enabled = rolePermissions[permission.key];
                return (
                  <label
                    key={permission.key}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition',
                      enabled
                        ? 'border-accent/40 bg-accent/[0.07]'
                        : 'border-line bg-panel hover:bg-panel3',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#6c7cff]"
                      checked={enabled}
                      onChange={() => togglePermission(permission.key)}
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-slate-200">
                        {permission.label}
                      </span>
                      <span className="block text-[10px] leading-snug text-muted">
                        {permission.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="btn-primary h-9 px-4 text-xs"
                disabled={roleBusy || roleName.trim().length < 2}
                onClick={saveRole}
              >
                {roleBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {editingRoleId ? 'Сохранить' : 'Создать роль'}
              </button>
              {editingRoleId && (
                <button className="btn-ghost h-9 px-4 text-xs" onClick={resetRoleForm}>
                  Отмена
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {roles.map((role) => {
              const memberCount =
                accounts?.filter((account) => account.roleIds.includes(role.id)).length ?? 0;
              const enabled = PERMISSION_META.filter(
                (permission) => role.permissions[permission.key],
              );
              return (
                <div
                  key={role.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-panel/40 px-3 py-2.5"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${role.color}22`, color: role.color }}
                  >
                    <Shield className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium" style={{ color: role.color }}>
                        {role.name}
                      </span>
                      <span className="text-[10px] text-muted">
                        {memberCount} уч.
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {enabled.length > 0 ? (
                        enabled.map((permission) => (
                          <span
                            key={permission.key}
                            className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-300"
                          >
                            {permission.label}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-muted">без прав</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="icon-btn h-8 w-8"
                    onClick={() => editRole(role)}
                    title="Изменить роль"
                    disabled={roleBusy}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="icon-btn h-8 w-8 text-muted hover:bg-danger/15 hover:text-danger"
                    onClick={() => deleteRole(role)}
                    title="Удалить роль"
                    disabled={roleBusy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {roles.length === 0 && <Empty text="Ролей пока нет — создайте первую." />}
          </div>

          <div className="rounded-xl border border-line bg-panel/40 p-4 text-[11px] leading-relaxed text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" />
              Как работают дополнительные роли
            </div>
            Дополнительная роль — это набор прав: вещание, модерация, каналы, управление ролями,
            группы слушателей и приглашения. Она выдаётся поверх базовой роли во вкладке
            «Аккаунты» и может открывать участнику доступ к закрытым каналам. Администратор
            всегда обладает всеми правами и управляет ролями.
          </div>
        </div>
      )}

      {tab === 'groups' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-panel/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              {editingGroupId ? (
                <Pencil className="h-4 w-4 text-accent" />
              ) : (
                <Plus className="h-4 w-4 text-accent" />
              )}
              {editingGroupId ? 'Изменить группу' : 'Новая группа слушателей'}
            </div>
            <input
              className="input"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Например: Операторы"
              maxLength={MAX_GROUP_NAME}
            />
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Кто слышит вещание
                </span>
                <span className="text-[10px] text-muted">выбрано: {groupMembers.length}</span>
              </div>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-panel p-1">
                {accounts?.map((account) => (
                  <label
                    key={account.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-panel3"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 accent-[#6c7cff]"
                      checked={groupMembers.includes(account.id)}
                      onChange={() => toggleGroupMember(account.id)}
                    />
                    <Avatar id={account.id} name={account.displayName} size="xs" />
                    <span className="truncate text-xs text-slate-200">{account.displayName}</span>
                    <span className="truncate text-[10px] text-muted">@{account.username}</span>
                    {account.role === 'admin' && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                        админ
                      </span>
                    )}
                    {account.banned && (
                      <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-danger">
                        забанен
                      </span>
                    )}
                  </label>
                ))}
                {!accounts && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted" />
                  </div>
                )}
                {accounts?.length === 0 && <Empty text="Зарегистрированных аккаунтов нет." />}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="btn-primary h-9 px-4 text-xs"
                disabled={groupBusy || !groupName.trim() || groupMembers.length === 0}
                onClick={saveGroup}
              >
                {groupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {editingGroupId ? 'Сохранить' : 'Создать группу'}
              </button>
              {editingGroupId && (
                <button className="btn-ghost h-9 px-4 text-xs" onClick={resetGroupForm}>
                  Отмена
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {groups.map((group) => {
              const memberNames = group.memberIds
                .map((id) => accounts?.find((account) => account.id === id)?.displayName)
                .filter((value): value is string => Boolean(value));
              return (
                <div
                  key={group.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-panel/40 px-3 py-2.5"
                >
                  <Users className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{group.name}</div>
                    <div className="truncate text-[10px] uppercase tracking-wider text-muted">
                      {group.memberIds.length} участн. · {memberNames.join(', ') || 'состав загружается'}
                    </div>
                  </div>
                  <button
                    className="icon-btn h-8 w-8"
                    onClick={() => editGroup(group)}
                    title="Изменить группу"
                    disabled={groupBusy}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="icon-btn h-8 w-8 text-muted hover:bg-danger/15 hover:text-danger"
                    onClick={() => deleteGroup(group)}
                    title="Удалить группу"
                    disabled={groupBusy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {groups.length === 0 && <Empty text="Групп пока нет — создайте первую." />}
          </div>

          <div className="rounded-xl border border-line bg-panel/40 p-4 text-[11px] leading-relaxed text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-300">
              <Radio className="h-3.5 w-3.5 text-accent" />
              Как работают группы
            </div>
            Группы — это наборы зарегистрированных участников, которые слышат вещание
            администратора в любом голосовом канале. В голосовом канале администратор включает
            «Все каналы» или отдельные группы отдельными кнопками.
          </div>
        </div>
      )}

      {tab === 'online' && (
        <div className="space-y-1.5">
          {users.map((user) => (
            <OnlineRow
              key={user.id}
              user={user}
              roles={roles}
              channels={channels}
              selfId={me.id}
              canModerate={canModerate}
              canAssignBaseRole={isAdmin}
              canPromoteGuest={isModerator}
              canAuthorizeGuest={isAdmin || isModerator}
              busy={busyKey === `online:${user.id}`}
              onAction={(key, emit) => runMod(`online:${user.id}`, emit)}
            />
          ))}
          {users.length === 0 && <Empty text="Сейчас никого нет в сети." />}
          {(isAdmin || isModerator) && (
            <div className="mt-4 rounded-xl border border-line bg-panel/40 p-4 text-[11px] leading-relaxed text-muted">
              <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-300">
                <UserCheck className="h-3.5 w-3.5 text-ok" />
                Роли и перемещение
              </div>
              Администратор меняет базовую роль участника в списке. Модератор видит все каналы,
              может перемещать участников между каналами и назначать гостю роль Пользователь.
              Кнопка с галочкой у гостя создаёт аккаунт и сразу выдаёт роль Пользователь —
              сгенерированные логин и пароль показываются один раз.
            </div>
          )}
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-1.5">
          {accountsError && <Empty text={accountsError} />}
          {!accounts && !accountsError && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          )}
          {accounts?.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              roles={roles}
              selfId={me.id}
              online={onlineIds.has(account.id)}
              canModerate={canModerate}
              canAssignRoles={canRoles}
              canAssignBaseRole={isAdmin}
              canPromoteGuest={isModerator}
              busy={busyKey === `account:${account.id}`}
              onAction={(emit) => runMod(`account:${account.id}`, emit)}
              onRolesSaved={() => void loadAccounts()}
            />
          ))}
          {accounts?.length === 0 && <Empty text="Зарегистрированных аккаунтов нет." />}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {[1, 7, 30, 90].map((days) => (
              <button
                key={days}
                className={cn(
                  'btn-ghost h-8 px-3 text-xs',
                  statsDays === days && 'border-accent/40 bg-accent/10 text-accent',
                )}
                onClick={() => setStatsDays(days)}
                disabled={statsLoading}
              >
                {days === 1 ? 'Сутки' : `${days} дней`}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-2 text-xs text-muted">
              Сейчас в сети: <b className="text-slate-200">{statsOnline}</b>
            </span>
            <button
              className="icon-btn h-8 w-8"
              title="Обновить"
              onClick={() => void loadStats(statsDays)}
              disabled={statsLoading}
            >
              <RefreshCw className={cn('h-4 w-4', statsLoading && 'animate-spin')} />
            </button>
          </div>

          {!stats ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Пиковый онлайн
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-100">{stats.peak}</p>
                </div>
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Средний онлайн
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-100">
                    {stats.average.toFixed(1)}
                  </p>
                </div>
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Участников
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-100">
                    {stats.uniqueUsers}
                  </p>
                </div>
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Суммарный онлайн
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-100">
                    {formatDuration(stats.totalSeconds)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-panel/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <BarChart3 className="h-3.5 w-3.5 text-accent" />
                    Средний онлайн по времени
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    интервал {Math.round(stats.bucketMs / 3_600_000)} ч
                  </span>
                </div>
                {stats.timeline.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted">
                    Данных пока нет — статистика собирается каждые 30 секунд.
                  </p>
                ) : (
                  <div className="flex h-32 items-end gap-[2px] overflow-x-auto">
                    {stats.timeline.map((point) => {
                      const max = Math.max(1, stats.peak);
                      return (
                        <div
                          key={point.t}
                          className="min-w-[5px] flex-1 rounded-t bg-accent/70 transition hover:bg-accent"
                          style={{ height: `${Math.max(2, (point.avg / max) * 100)}%` }}
                          title={`${new Date(point.t).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })} · средний ${point.avg.toFixed(1)}, пик ${point.peak}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-panel3/60 text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3 py-2">День</th>
                      <th className="px-3 py-2">Пик</th>
                      <th className="px-3 py-2">Средний</th>
                      <th className="px-3 py-2">Участников</th>
                      <th className="px-3 py-2">Онлайн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.daily.map((day) => (
                      <tr key={day.date} className="border-t border-line/60">
                        <td className="px-3 py-1.5 text-slate-300">{day.date}</td>
                        <td className="px-3 py-1.5 text-slate-200">{day.peak}</td>
                        <td className="px-3 py-1.5 text-slate-200">{day.average.toFixed(1)}</td>
                        <td className="px-3 py-1.5 text-slate-200">{day.users}</td>
                        <td className="px-3 py-1.5 text-slate-200">
                          {formatDuration(day.seconds)}
                        </td>
                      </tr>
                    ))}
                    {stats.daily.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-muted">
                          Нет данных за период
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-panel3/60 text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3 py-2">Участник</th>
                      <th className="px-3 py-2">Время в сети</th>
                      <th className="px-3 py-2">Сессий</th>
                      <th className="px-3 py-2">Был(а)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.map((user) => (
                      <tr key={user.userId} className="border-t border-line/60">
                        <td className="px-3 py-1.5 text-slate-300">
                          {user.displayName}
                          {user.guest && (
                            <span className="ml-1.5 rounded bg-amber-400/10 px-1 py-0.5 text-[9px] uppercase text-amber-300">
                              гость
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-200">
                          {formatDuration(user.seconds)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-200">{user.sessions}</td>
                        <td className="px-3 py-1.5 text-muted">
                          {new Date(user.lastSeen).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                    {stats.users.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted">
                          Нет данных об участниках
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'invite' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-panel/60 p-4">
            <div className="text-sm font-semibold text-slate-200">Доступ гостей</div>
            {invite ? (
              invite.allowGuests ? (
                <>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-bg/50 p-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[#6c7cff]"
                      checked={invite.inviteRequired}
                      disabled={inviteBusy}
                      onChange={(event) => setInviteRequired(event.target.checked)}
                    />
                    <div>
                      <div className="text-xs font-medium text-slate-200">
                        Требовать код приглашения
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                        Выключите, чтобы гостю было достаточно ввести ник — без кода и ссылки.
                      </p>
                    </div>
                  </label>

                  {invite.inviteRequired ? (
                    <>
                      <p className="mt-3 text-[11px] leading-relaxed text-muted">
                        Отправьте ссылку — гость введёт только имя, без регистрации. Он попадёт в
                        гостевой канал; чтобы открыть остальные каналы, назначьте ему роль
                        Пользователь во вкладке «В сети».
                      </p>
                      <div className="mt-4 flex items-center gap-2">
                        <code className="block min-w-0 flex-1 truncate rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-xs text-slate-100">
                          {guestLink}
                        </code>
                        <button
                          className="btn-primary h-[42px] px-3"
                          onClick={() => void copyText(guestLink)}
                          title="Скопировать ссылку"
                        >
                          <Copy className="h-4 w-4" />
                          Ссылка
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <span>Код:</span>
                        <code className="rounded border border-line bg-bg px-2 py-1 font-mono tracking-[0.15em] text-slate-200">
                          {invite.code}
                        </code>
                        <button
                          className="text-accent hover:underline"
                          onClick={() => void copyText(invite.code)}
                        >
                          копировать
                        </button>
                      </div>
                      <button
                        className="btn-ghost mt-3 h-8 px-3 text-xs"
                        onClick={regenerate}
                        disabled={inviteBusy}
                      >
                        {inviteBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Сгенерировать новый код
                      </button>
                    </>
                  ) : (
                    <p className="mt-3 rounded-lg border border-ok/20 bg-ok/5 px-3 py-2 text-[11px] leading-relaxed text-ok">
                      Гости входят через вкладку «Гость», указав только ник. Ссылка и код
                      приглашения не нужны — включите режим выше, чтобы вернуть их.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-warn">
                  Гостевой вход отключён на этом сервере (ALLOW_GUESTS=false).
                </p>
              )
            ) : (
              <div className="mt-4 flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted" />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-panel/40 p-4 text-[11px] leading-relaxed text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-300">
              <Shield className="h-3.5 w-3.5 text-accent" />
              Права и роли
            </div>
            Базовые роли задают уровень доступа: гость, пользователь, модератор, админ. Права
            выдаются дополнительными ролями во вкладке «Роли» и назначаются в «Аккаунтах».
            Администратор всегда обладает всеми правами.
          </div>
        </div>
      )}
    </Modal>
  );
}

function OnlineRow({
  user,
  roles,
  channels,
  selfId,
  canModerate,
  canAssignBaseRole,
  canPromoteGuest,
  canAuthorizeGuest,
  busy,
  onAction,
}: {
  user: OnlineUser;
  roles: Role[];
  channels: Channel[];
  selfId: string;
  canModerate: boolean;
  canAssignBaseRole: boolean;
  canPromoteGuest: boolean;
  canAuthorizeGuest: boolean;
  busy: boolean;
  onAction: (
    key: string,
    emit: (callback: (result: { ok: boolean; error?: string }) => void) => void,
  ) => void;
}) {
  const socket = getSocket();
  const self = user.id === selfId;
  const color = roleColor(user, roles);
  const customRoles = userRoleList(user, roles);
  const moveTargets = channels.filter(
    (channel) => channel.type === 'voice' && channel.id !== user.channelId,
  );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel/40 px-3 py-2.5">
      <Avatar id={user.id} name={user.displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm text-slate-200" style={color ? { color } : undefined}>
            {user.displayName}
          </span>
          <LabelBadge label={user.label} />
          {user.role === 'admin' && <Shield className="h-3 w-3 shrink-0 text-accent" />}
          {user.broadcasting && <Radio className="h-3 w-3 shrink-0 text-ok" />}
          {customRoles.map((role) => (
            <span
              key={role.id}
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ backgroundColor: `${role.color}22`, color: role.color }}
            >
              {role.name}
            </span>
          ))}
        </div>
        <div className="truncate text-[10px] uppercase tracking-wider text-muted">
          {roleLabel(user, roles)}
          {user.channelId ? ' · в канале' : ' · без канала'}
        </div>
      </div>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      {!self && (canModerate || canAssignBaseRole || canPromoteGuest || canAuthorizeGuest) && (
        <div className="flex items-center gap-1">
          {canModerate && (
            <button
              className="icon-btn h-8 w-8"
              title="Подписать участника"
              disabled={Boolean(busy)}
              onClick={() => {
                const next = window.prompt(
                  'Метка рядом с ником (до 20 символов, пусто — убрать):',
                  user.label ?? '',
                );
                if (next === null) return;
                onAction('label', (callback) =>
                  socket?.emit('mod:setLabel', { userId: user.id, label: next }, callback),
                );
              }}
            >
              <Tag className="h-4 w-4" />
            </button>
          )}
          {canModerate && (
            <button
              className="icon-btn h-8 w-8"
              title={user.serverMuted ? 'Вернуть микрофон' : 'Отключить микрофон'}
              disabled={Boolean(busy)}
              onClick={() =>
                onAction('mute', (callback) =>
                  socket?.emit(
                    'mod:serverMute',
                    { userId: user.id, muted: !user.serverMuted },
                    callback,
                  ),
                )
              }
            >
              {user.serverMuted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
          )}
          {canModerate && user.channelId && (
            <button
              className="icon-btn h-8 w-8 hover:bg-warn/15 hover:text-warn"
              title="Выгнать из канала"
              disabled={Boolean(busy)}
              onClick={() =>
                onAction('kick', (callback) =>
                  socket?.emit('mod:kick', { userId: user.id }, callback),
                )
              }
            >
              <UserX className="h-4 w-4" />
            </button>
          )}
          {canModerate && user.channelId && moveTargets.length > 0 && (
            <select
              className="input h-8 w-auto py-0 text-[11px]"
              value=""
              disabled={Boolean(busy)}
              title="Переместить в канал"
              onChange={(event) => {
                const channelId = event.target.value;
                if (!channelId) return;
                onAction('move', (callback) =>
                  socket?.emit('mod:moveUser', { userId: user.id, channelId }, callback),
                );
              }}
            >
              <option value="">Переместить…</option>
              {moveTargets.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          )}
          {canAuthorizeGuest && user.isGuest && (
            <button
              className="icon-btn h-8 w-8 hover:bg-ok/15 hover:text-ok"
              title="Назначить роль Пользователь — открыть каналы участников"
              disabled={Boolean(busy)}
              onClick={() => {
                if (
                  !window.confirm(
                    `Назначить ${user.displayName} роль Пользователь? Аккаунт сохранится в «Аккаунтах».`,
                  )
                ) {
                  return;
                }
                onAction('authorize', (callback) =>
                  socket?.emit('mod:authorizeGuest', { userId: user.id }, (result) => {
                    callback(result);
                    if (result.ok) {
                      toast('ok', 'Назначена роль Пользователь');
                      window.prompt(
                        'Гость стал пользователем. Логин и пароль:',
                        `Логин: ${result.username} · Пароль: ${result.password}`,
                      );
                    }
                  }),
                );
              }}
            >
              <UserCheck className="h-4 w-4" />
            </button>
          )}
          {canAssignBaseRole && !self && !user.isGuest && (
            <select
              className="input h-8 w-auto py-0 text-[11px]"
              value={user.role}
              disabled={Boolean(busy)}
              title="Роль участника"
              onChange={(event) => {
                const role = event.target.value as BaseRole;
                onAction('role', (callback) =>
                  socket?.emit('mod:setRole', { userId: user.id, role }, callback),
                );
              }}
            >
              {BASE_ROLE_META.map((meta) => (
                <option key={meta.key} value={meta.key}>
                  {meta.label}
                </option>
              ))}
            </select>
          )}
          {canPromoteGuest &&
            !canAssignBaseRole &&
            !self &&
            !user.isGuest &&
            user.role === 'guest' && (
              <button
                className="icon-btn h-8 w-8 hover:bg-ok/15 hover:text-ok"
                title="Назначить роль Пользователь"
                disabled={Boolean(busy)}
                onClick={() =>
                  onAction('role', (callback) =>
                    socket?.emit(
                      'mod:setRole',
                      { userId: user.id, role: 'member' },
                      callback,
                    ),
                  )
                }
              >
                <UserCheck className="h-4 w-4" />
              </button>
            )}
          {canModerate && !user.isGuest && user.role !== 'admin' && (
            <button
              className="icon-btn h-8 w-8 hover:bg-danger/15 hover:text-danger"
              title="Забанить"
              disabled={Boolean(busy)}
              onClick={() => {
                if (!window.confirm(`Забанить ${user.displayName}? Аккаунт потеряет доступ.`)) {
                  return;
                }
                onAction('ban', (callback) =>
                  socket?.emit('mod:ban', { userId: user.id, banned: true }, callback),
                );
              }}
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  roles,
  selfId,
  online,
  canModerate,
  canAssignRoles,
  canAssignBaseRole,
  canPromoteGuest,
  busy,
  onAction,
  onRolesSaved,
}: {
  account: AdminUser;
  roles: Role[];
  selfId: string;
  online: boolean;
  canModerate: boolean;
  canAssignRoles: boolean;
  canAssignBaseRole: boolean;
  canPromoteGuest: boolean;
  busy: boolean;
  onAction: (
    emit: (callback: (result: { ok: boolean; error?: string }) => void) => void,
  ) => void;
  onRolesSaved: () => void;
}) {
  const socket = getSocket();
  const self = account.id === selfId;
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(account.roleIds);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!panelOpen) setSelected(account.roleIds);
  }, [account.roleIds, panelOpen]);

  const color = roleColor(account, roles);
  const assigned = userRoleList(account, roles);
  const assignable =
    canAssignRoles &&
    !self &&
    account.role !== 'admin' &&
    account.role !== 'guest' &&
    !account.isGuest;

  function toggleRole(roleId: string): void {
    setSelected((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  }

  function saveRoles(): void {
    if (!socket || saving) return;
    setSaving(true);
    socket.emit('mod:setUserRoles', { userId: account.id, roleIds: selected }, (result) => {
      setSaving(false);
      if (!result.ok) {
        toast('error', result.error ?? 'Не удалось обновить роли');
        return;
      }
      setPanelOpen(false);
      toast('ok', 'Роли обновлены');
      onRolesSaved();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-panel/40">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <Avatar id={account.id} name={account.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="truncate text-sm text-slate-200"
              style={color ? { color } : undefined}
            >
              {account.displayName}
            </span>
            <LabelBadge label={account.label} />
            <span className="truncate text-[11px] text-muted">@{account.username}</span>
            {account.role === 'admin' && (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                админ
              </span>
            )}
            {assigned.map((role) => (
              <span
                key={role.id}
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ backgroundColor: `${role.color}22`, color: role.color }}
              >
                {role.name}
              </span>
            ))}
            {account.banned && (
              <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-danger">
                забанен
              </span>
            )}
            {self && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-slate-300">
                вы
              </span>
            )}
          </div>
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">
            {roleLabel(account, roles)} · {online ? 'в сети' : 'не в сети'} · создан{' '}
            {formatDate(account.createdAt)}
          </div>
        </div>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        <div className="flex items-center gap-1">
          {canModerate && (
            <button
              className="icon-btn h-8 w-8"
              title="Подписать участника"
              disabled={Boolean(busy)}
              onClick={() => {
                const next = window.prompt(
                  'Метка рядом с ником (до 20 символов, пусто — убрать):',
                  account.label ?? '',
                );
                if (next === null) return;
                onAction((callback) =>
                  socket?.emit('mod:setLabel', { userId: account.id, label: next }, callback),
                );
              }}
            >
              <Tag className="h-4 w-4" />
            </button>
          )}
          {assignable && (
            <button
              className={cn('icon-btn h-8 w-8', panelOpen && 'icon-btn-active')}
              title="Роли"
              onClick={() => setPanelOpen((value) => !value)}
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          )}
          {!self && canAssignBaseRole && (
            <select
              className="input h-8 w-auto py-0 text-[11px]"
              value={account.role}
              disabled={Boolean(busy)}
              title="Базовая роль"
              onChange={(event) => {
                const role = event.target.value as BaseRole;
                onAction((callback) =>
                  socket?.emit('mod:setRole', { userId: account.id, role }, callback),
                );
              }}
            >
              {BASE_ROLE_META.map((meta) => (
                <option key={meta.key} value={meta.key}>
                  {meta.label}
                </option>
              ))}
            </select>
          )}
          {!self &&
            !canAssignBaseRole &&
            canPromoteGuest &&
            account.role === 'guest' &&
            !account.isGuest && (
              <button
                className="icon-btn h-8 w-8 hover:bg-ok/15 hover:text-ok"
                title="Назначить роль Пользователь"
                disabled={Boolean(busy)}
                onClick={() =>
                  onAction((callback) =>
                    socket?.emit(
                      'mod:setRole',
                      { userId: account.id, role: 'member' },
                      callback,
                    ),
                  )
                }
              >
                <UserCheck className="h-4 w-4" />
              </button>
            )}
          {!self &&
            canModerate &&
            account.role !== 'admin' &&
            (account.banned ? (
              <button
                className="icon-btn h-8 w-8 hover:bg-ok/15 hover:text-ok"
                title="Разблокировать"
                disabled={Boolean(busy)}
                onClick={() =>
                  onAction((callback) =>
                    socket?.emit('mod:ban', { userId: account.id, banned: false }, callback),
                  )
                }
              >
                <Check className="h-4 w-4" />
              </button>
            ) : (
              <button
                className="icon-btn h-8 w-8 hover:bg-danger/15 hover:text-danger"
                title="Забанить"
                disabled={Boolean(busy)}
                onClick={() => {
                  if (!window.confirm(`Забанить ${account.displayName}? Аккаунт потеряет доступ.`)) {
                    return;
                  }
                  onAction((callback) =>
                    socket?.emit('mod:ban', { userId: account.id, banned: true }, callback),
                  );
                }}
              >
                <Ban className="h-4 w-4" />
              </button>
            ))}
        </div>
      </div>

      {assignable && panelOpen && (
        <div className="border-t border-line px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Роли участника
            </span>
            <span className="text-[10px] text-muted">выбрано: {selected.length}</span>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {roles.map((role) => {
              const checked = selected.includes(role.id);
              const enabled = PERMISSION_META.filter(
                (permission) => role.permissions[permission.key],
              );
              return (
                <label
                  key={role.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition',
                    checked
                      ? 'border-accent/40 bg-accent/[0.07]'
                      : 'border-line bg-panel hover:bg-panel3',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#6c7cff]"
                    checked={checked}
                    onChange={() => toggleRole(role.id)}
                  />
                  <span className="min-w-0">
                    <span
                      className="flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: role.color }}
                    >
                      <Shield className="h-3 w-3 shrink-0" />
                      {role.name}
                    </span>
                    <span className="block text-[10px] leading-snug text-muted">
                      {enabled.length > 0
                        ? enabled.map((permission) => permission.label).join(' · ')
                        : 'без прав'}
                    </span>
                  </span>
                </label>
              );
            })}
            {roles.length === 0 && (
              <p className="col-span-full px-1 py-2 text-[11px] text-muted">
                Ролей пока нет — создайте их во вкладке «Роли».
              </p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-primary h-8 px-3 text-xs"
              disabled={saving || roles.length === 0}
              onClick={saveRoles}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Сохранить роли
            </button>
            <button
              className="btn-ghost h-8 px-3 text-xs"
              onClick={() => {
                setSelected(account.roleIds);
                setPanelOpen(false);
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
