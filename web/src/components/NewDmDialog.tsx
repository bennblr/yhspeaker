import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { LabelBadge } from './LabelBadge';
import { useApp } from '../lib/store';
import { openDirectChat } from '../lib/actions';
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
  const [query, setQuery] = useState('');

  // Один аккаунт может быть в сети с нескольких устройств — в списке он один.
  const candidates = useMemo(() => {
    const unique = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      if (user.id === me?.id || unique.has(user.id)) continue;
      unique.set(user.id, user);
    }
    const list = [...unique.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'ru'),
    );
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((user) => user.displayName.toLowerCase().includes(needle));
  }, [users, me?.id, query]);

  function pick(user: (typeof users)[number]): void {
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
      subtitle="Выберите участника, который сейчас в сети"
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
            <Avatar id={user.id} name={user.displayName} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-100">
                  {user.displayName}
                </span>
                <LabelBadge label={user.label} />
              </span>
              <span className="block truncate text-[11px] text-muted">
                {roleLabel(user, roles)}
                {user.deviceName ? ` · ${user.deviceName}` : ''}
              </span>
            </span>
          </button>
        ))}
        {candidates.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">
            {query.trim() ? 'Никого не нашли' : 'Сейчас никого нет в сети'}
          </p>
        )}
      </div>
    </Modal>
  );
}
