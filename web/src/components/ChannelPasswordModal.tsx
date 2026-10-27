import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../lib/store';
import { getSocket } from '../lib/socket';
import { joinVoice, selectChannel } from '../lib/actions';

export function ChannelPasswordModal() {
  const lock = useApp((state) => state.channelLock);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setBusy(false);
    setError(null);
  }, [lock?.channelId, lock?.action]);

  function close(): void {
    if (busy) return;
    useApp.getState().setChannelLock(null);
  }

  function submit(): void {
    if (!lock || busy) return;
    const socket = getSocket();
    if (!socket?.connected) {
      setError('Нет соединения с сервером');
      return;
    }
    setBusy(true);
    setError(null);
    socket.emit('channel:unlock', { channelId: lock.channelId, password }, (result) => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? 'Не удалось открыть канал');
        return;
      }
      const state = useApp.getState();
      state.markChannelUnlocked(lock.channelId);
      state.setChannelLock(null);
      if (lock.action === 'join') void joinVoice(lock.channelId);
      else selectChannel(lock.channelId);
    });
  }

  return (
    <Modal
      open={Boolean(lock)}
      onClose={close}
      title="Канал защищён паролем"
      subtitle={lock ? `Введите пароль для канала «${lock.channelName}»` : undefined}
      width="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-ghost h-9 px-4 text-xs" onClick={close} disabled={busy}>
            Отмена
          </button>
          <button
            className="btn-primary h-9 px-4 text-xs"
            onClick={submit}
            disabled={busy || password.length === 0}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            Открыть канал
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            Пароль канала
          </span>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              autoFocus
              type="password"
              className="input pl-9"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              placeholder="Введите пароль"
              maxLength={64}
              disabled={busy}
            />
          </div>
        </label>
        {error && (
          <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted">
          {lock?.action === 'join'
            ? 'После ввода пароля вы подключитесь к голосовому каналу. Доступ сохранится до конца сессии.'
            : 'Доступ к каналу сохранится до конца сессии.'}
        </p>
      </div>
    </Modal>
  );
}
