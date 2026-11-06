import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { DmCandidate } from '@tsds/shared';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { LabelBadge } from './LabelBadge';
import { useApp } from '../lib/store';
import { loadDmParticipants, openDirectChat } from '../lib/actions';
import { roleLabel } from '../lib/roles';
import { cn } from '../lib/utils';

export function NewDmDialog({
  open,
  onClose,
  onPicked,
}: {
  open: boolean;
  onClose: () => void;
  onPicked?: () => void;
}) {
  const me = useApp((state) => state.me);
  const users = useApp((state) => state.users);
  const roles = useApp((state) => state.roles);
  const [serverCandidates, setServerCandidates] = useState<DmCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadDmParticipants((participants) => {
      setServerCandidates(participants);
      setLoading(false);
    });
  }, [open]);

  // Сервер отдаёт все аккаунты, включая офлайн; живые сессии уточняют статус,
  // ник и устройство. Один аккаунт с нескольких устройств показываем один раз.
  const candidates = useMemo(() => {
    const onlineByUser = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      if (!onlineByUser.has(user.id)) onlineByUser.set(user.id, user);
    }

    const merged = new Map<string, DmCandidate>();
    for (const candidate of serverCandidates) {
      if (candidate.id === me?.id) continue;
      const live = onlineByUser.get(candidate.id);
      merged.set(
        candidate.id,
        live
          ? {
              ...candidate,
              displayName: live.displayName,
              label: live.label,
              role: live.role,
              isGuest: live.isGuest,
              roleIds: live.roleIds,
              online: true,
              deviceName: live.deviceName,
            }
          : { ...candidate, online: false, deviceName: undefined },
      );
    }
    for (const live of onlineByUser.values()) {
      if (live.id === me?.id || merged.has(live.id)) continue;
      merged.set(live.id, {
        id: live.id,
        displayName: live.displayName,
        label: live.label,
        role: live.role,
        isGuest: live.isGuest,
        roleIds: live.roleIds,
        online: true,
        deviceName: live.deviceName,
      });
    }

    const list = [...merged.values()].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, 'ru');
    });
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (user) =>
        user.displayName.toLowerCase().includes(needle) ||
        user.label?.toLowerCase().includes(needle),
    );
  }, [serverCandidates, users, me?.id, query]);

  function pick(user: DmCandidate): void {
    openDirectChat(user);
    setQuery('');
    onClose();
    onPicked?.();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title="Личный чат"
      subtitle="Можно написать любому участнику сервера, даже если он не в сети"
      width="max-w-md"
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по нику"
          autoFocus
        />
      </div>
      <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
        {candidates.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => pick(user)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition',
              'hover:bg-white/[0.05]',
            )}
          >
            <Avatar
              id={user.id}
              name={user.displayName}
              size="sm"
              className={cn(!user.online && 'opacity-45 saturate-50')}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-100">
                  {user.displayName}
                </span>
                <LabelBadge label={user.label} />
              </span>
              <span className="flex items-center gap-1.5 truncate text-[11px] text-muted">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    user.online ? 'bg-ok' : 'bg-slate-600',
                  )}
                />
                {roleLabel(user, roles)}
                {user.online ? (user.deviceName ? ` · ${user.deviceName}` : ' · в сети') : ' · не в сети'}
              </span>
            </span>
          </button>
        ))}
        {candidates.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">
            {query.trim()
              ? 'Никого не нашли'
              : loading
                ? 'Загружаем участников…'
                : 'На сервере пока нет других участников'}
          </p>
        )}
      </div>
    </Modal>
  );
}
