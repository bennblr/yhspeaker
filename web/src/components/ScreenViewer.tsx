import { useEffect, useRef } from 'react';
import { Maximize2, MonitorUp, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { useApp } from '../lib/store';
import { closeScreenViewer } from '../lib/actions';

export function ScreenViewer() {
  const viewerId = useApp((state) => state.voice.viewerSessionId);
  const stream = useApp((state) =>
    state.voice.viewerSessionId
      ? state.voice.remoteScreens[state.voice.viewerSessionId]
      : undefined,
  );
  const user = useApp((state) =>
    state.voice.viewerSessionId
      ? state.users.find((item) => item.sessionId === state.voice.viewerSessionId)
      : undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!viewerId) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeScreenViewer();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewerId]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [stream, viewerId]);

  if (!viewerId) return null;

  function fullscreen(): void {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void element.requestFullscreen().catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <MonitorUp className="h-4 w-4 text-accent" />
        <Avatar id={viewerId} name={user?.displayName ?? 'Участник'} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-100">
            Экран: {user?.displayName ?? 'Участник'}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted">
            демонстрация экрана{user ? ` · ${user.deviceName}` : ''}
          </div>
        </div>
        <button className="icon-btn h-8 w-8" onClick={fullscreen} title="На весь экран">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button className="icon-btn h-8 w-8" onClick={closeScreenViewer} title="Закрыть (Esc)">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center bg-black">
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="text-sm text-muted">Демонстрация завершена или ещё загружается…</p>
        )}
      </div>
    </div>
  );
}
