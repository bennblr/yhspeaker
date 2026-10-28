import {
  BASE_ROLE_LABELS,
  hasAnyPermission,
  hasPermission,
  type BaseRole,
  type OnlineUser,
  type PermissionKey,
  type Role,
} from '@tsds/shared';
import { useApp } from './store';

export const BASE_ROLE_META: { key: BaseRole; label: string; hint: string; color: string }[] = [
  {
    key: 'guest',
    label: BASE_ROLE_LABELS.guest,
    hint: 'Только каналы, открытые для гостей. Выдаётся при регистрации и входе гостем.',
    color: '#f59e0b',
  },
  {
    key: 'member',
    label: BASE_ROLE_LABELS.member,
    hint: 'Видит каналы, открытые для пользователей и его ролей. Базовый уровень аккаунта.',
    color: '#38bdf8',
  },
  {
    key: 'moderator',
    label: BASE_ROLE_LABELS.moderator,
    hint: 'Видит все каналы, может перемещать участников и назначать гостю роль Пользователь.',
    color: '#22c55e',
  },
  {
    key: 'admin',
    label: BASE_ROLE_LABELS.admin,
    hint: 'Всё, что может модератор, плюс управление ролями и назначение любых ролей.',
    color: '#6c7cff',
  },
];

export const PERMISSION_META: { key: PermissionKey; label: string; hint: string }[] = [
  { key: 'broadcast', label: 'Вещание', hint: 'Говорить во все голосовые каналы и группы слушателей' },
  { key: 'moderate', label: 'Модерация', hint: 'Мьют, кик, бан и удаление сообщений' },
  { key: 'channels', label: 'Каналы', hint: 'Создавать и удалять голосовые и текстовые каналы' },
  { key: 'roles', label: 'Роли', hint: 'Создавать роли и выдавать их участникам' },
  { key: 'groups', label: 'Группы', hint: 'Настраивать группы слушателей вещания' },
  { key: 'invite', label: 'Приглашения', hint: 'Смотреть и перегенерировать гостевой код' },
];

export const ROLE_COLORS = [
  '#6c7cff',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#38bdf8',
  '#ef4444',
];

export function userRoleList(
  user: Pick<OnlineUser, 'roleIds'> | null | undefined,
  roles: Role[],
): Role[] {
  if (!user) return [];
  return user.roleIds
    .map((id) => roles.find((role) => role.id === id))
    .filter((role): role is Role => Boolean(role));
}

export function primaryRole(
  user: Pick<OnlineUser, 'roleIds'> | null | undefined,
  roles: Role[],
): Role | null {
  return userRoleList(user, roles)[0] ?? null;
}

export function roleColor(
  user: Pick<OnlineUser, 'roleIds'> | null | undefined,
  roles: Role[],
): string | null {
  return primaryRole(user, roles)?.color ?? null;
}

export function roleLabel(
  user: Pick<OnlineUser, 'role' | 'isGuest' | 'roleIds'>,
  roles: Role[],
): string {
  if (user.role === 'admin') return 'администратор';
  if (user.role === 'moderator') return 'модератор';
  if (user.role === 'guest') return 'гость';
  return primaryRole(user, roles)?.name ?? 'пользователь';
}

export function useCan(permission: PermissionKey): boolean {
  const me = useApp((state) => state.me);
  const roles = useApp((state) => state.roles);
  return hasPermission(me, roles, permission);
}

export function useIsStaff(): boolean {
  const me = useApp((state) => state.me);
  const roles = useApp((state) => state.roles);
  return hasAnyPermission(me, roles);
}
