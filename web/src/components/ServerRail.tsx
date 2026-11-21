import { useMemo, useState } from 'react';
import { Check, Copy, LogIn, Plus, Server as ServerIcon } from 'lucide-react';
import type { ServerSummary } from '@tsds/shared';
import { Modal } from './Modal';
import { useApp } from '../lib/store';
import { getSocket } from '../lib/socket';
import { voice } from '../lib/voice';
import { toast } from '../lib/actions';
import { cn, initials } from '../lib/utils';

// Рейл серверов слева от списка каналов: как в Discord, один аккаунт
// переключается между пространствами, создаёт свои и входит по коду.
export function ServerRail() {
  const servers = useApp((state) => state.servers);
  const serverId = useApp((state) => state.serverId);
  const me = useApp((state) => state.me);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const current = useMemo<ServerSummary | null>(
    () => servers.find((server) => server.id === serverId) ?? null,
    [servers, serverId],
  );
  const canCreate = servers.some((server) => server.canCreate);
  const isGuest = Boolean(me?.isGuest);

  function socketOrToast() {
    const socket = getSocket();
    if (!socket?.connected) {
      toast('error', 'Нет соединения с сервером');
      return null;
    }
    return socket;
  }

  function openServer(target: string): void {
    if (!target || target === serverId) return;
    const socket = socketOrToast();
    if (!socket) return;
    voice.abort();
    socket.emit('server:select', { serverId: target }, (result) => {
      if (!result.ok) toast('error', result.error ?? 'Не удалось открыть сервер');
    });
  }

  function createServer(): void {
    const label = name.trim();
    if (label.length < 2) {
      toast('error', 'Название сервера: минимум 2 символа');
      return;
    }
    const socket = socketOrToast();
    if (!socket) return;
    setBusy(true);
    voice.abort();
    socket.emit('server:create', { name: label }, (result) => {
      setBusy(false);
      if (!result.ok) {
        toast('error', result.error ?? 'Не удалось создать сервер');
        return;
      }
      setName('');
      setCreateOpen(false);
      toast('ok', `Сервер «${label}» создан`);
    });
  }

  function joinServer(): void {
    const invite = code.trim();
    if (!invite) {
      toast('error', 'Введите код приглашения');
      return;
    }
    const socket = socketOrToast();
    if (!socket) return;
    setBusy(true);
    voice.abort();
    socket.emit('server:join', { code: invite }, (result) => {
      setBusy(false);
      if (!result.ok) {
        toast('error', result.error ?? 'Не удалось войти на сервер');
        return;
      }
      setCode('');
      setJoinOpen(false);
    });
  }

  async function copyInvite(): Promise<void> {
    if (!current?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(current.inviteCode);
      setCopied(true);
      toast('ok', 'Код приглашения скопирован');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('info', `Код приглашения: ${current.inviteCode}`);
    }
  }

  return (
    <>
      <aside className="flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-line bg-bg py-3">
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 shadow-glow">
          <ServerIcon className="h-5 w-5 text-white" />
        </div>
        <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1">
          {servers.map((server) => {
            const active = server.id === serverId;
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => openServer(server.id)}
                title={`${server.name} · участников: ${server.memberCount}`}
                className={cn(
                  'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold uppercase transition',
                  active
                    ? 'bg-gradient-to-br from-accent to-accent2 text-white shadow-glow'
                    : 'bg-panel2 text-slate-300 hover:bg-panel3 hover:text-white',
                )}
              >
                <span
                  className={cn(
                    'absolute -left-[9px] w-1 rounded-r bg-accent transition-all',
                    active ? 'h-6 opacity-100' : 'h-1 opacity-0',
                  )}
                />
                {initials(server.name)}
              </button>
            );
          })}
          {!isGuest && (
            <div className="mt-1 flex flex-col items-center gap-2 border-t border-line pt-2">
              {canCreate && (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  title="Создать сервер"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-line text-muted transition hover:border-accent hover:text-white"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setJoinOpen(true)}
                title="Войти по приглашению"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-solid border-line text-muted transition hover:border-accent hover:text-white"
              >
                <LogIn className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {current?.inviteCode && (
          <button
            type="button"
            onClick={() => void copyInvite()}
            title={`Скопировать код приглашения: ${current.inviteCode}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel2 text-muted transition hover:text-white"
          >
            {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
      </aside>

      <Modal
        open={createOpen}
        onClose={() => {
          if (busy) return;
          setCreateOpen(false);
        }}
        title="Новый сервер"
        subtitle="Отдельные каналы, роли и участники внутри вашего аккаунта"
        width="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-9 px-4 text-xs"
              onClick={() => setCreateOpen(false)}
              disabled={busy}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary h-9 px-4 text-xs"
              onClick={createServer}
              disabled={busy}
            >
              Создать
            </button>
          </div>
        }
      >
        <label className="block text-xs font-medium text-muted" htmlFor="server-name">
          Название
        </label>
        <input
          id="server-name"
          className="input mt-1"
          value={name}
          maxLength={40}
          placeholder="Например, «Игровой сервер»"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') createServer();
          }}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Вы станете администратором нового сервера. Внутри сразу появятся
          голосовой канал «Общий» и текстовый «Общий чат».
        </p>
      </Modal>

      <Modal
        open={joinOpen}
        onClose={() => {
          if (busy) return;
          setJoinOpen(false);
        }}
        title="Присоединиться к серверу"
        subtitle="Введите код приглашения, который дал администратор сервера"
        width="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-9 px-4 text-xs"
              onClick={() => setJoinOpen(false)}
              disabled={busy}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary h-9 px-4 text-xs"
              onClick={joinServer}
              disabled={busy}
            >
              Войти
            </button>
          </div>
        }
      >
        <label className="block text-xs font-medium text-muted" htmlFor="server-invite">
          Код приглашения
        </label>
        <input
          id="server-invite"
          className="input mt-1 font-mono tracking-wider"
          value={code}
          maxLength={64}
          placeholder="например, 4f9c1a7b"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') joinServer();
          }}
        />
      </Modal>
    </>
  );
}
