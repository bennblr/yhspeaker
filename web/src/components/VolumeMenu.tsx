import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { OnlineUser } from '@tsds/shared';
import { Avatar } from './Avatar';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';

export function VolumeMenu({
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
