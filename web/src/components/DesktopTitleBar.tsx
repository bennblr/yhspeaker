import { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Minus, Radio, Server, X } from 'lucide-react';
import { desktop } from '../lib/desktop';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';

export function DesktopTitleBar({ serverName }: { serverName: string }) {
  const connection = useApp((state) => state.connection);
  const me = useApp((state) => state.me);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const controls = desktop?.windowControls;
    if (!controls) return;
    let active = true;
    void controls.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });
    const off = controls.onMaximizeChange(setMaximized);
    return () => {
      active = false;
      off();
    };
  }, []);

  if (!desktop) return null;
  const bridge = desktop;

  return (
    <header className="app-drag flex h-9 shrink-0 select-none items-center gap-2 border-b border-line bg-[#090b10] pl-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent2">
          <Radio className="h-3 w-3 text-white" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
          YHSpeak
        </span>
        {serverName !== 'YHSpeak' && (
          <>
            <div className="mx-0.5 h-3.5 w-px bg-line" />
            <span className="truncate text-[11px] text-muted">{serverName}</span>
          </>
        )}
      </div>

      {me && connection !== 'online' && (
        <span
          className={cn(
            'ml-1 flex shrink-0 items-center gap-1.5 text-[10px]',
            connection === 'connecting' ? 'text-warn' : 'text-danger',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connection === 'connecting' ? 'animate-pulse-soft bg-warn' : 'bg-danger',
            )}
          />
          {connection === 'connecting' ? 'подключение' : 'нет связи'}
        </span>
      )}

      <div className="app-no-drag ml-auto flex h-full items-stretch">
        <button
          type="button"
          className="flex h-full items-center gap-1.5 px-3 text-[11px] text-muted transition hover:bg-panel3 hover:text-slate-200"
          onClick={() => void bridge.changeServer()}
          title="Сменить сервер"
        >
          <Server className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Сервер</span>
        </button>
        <div className="my-2 w-px bg-line" />
        <button
          type="button"
          className="flex w-11 items-center justify-center text-muted transition hover:bg-panel3 hover:text-slate-100"
          onClick={() => void bridge.windowControls.minimize()}
          title="Свернуть"
          aria-label="Свернуть окно"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex w-11 items-center justify-center text-muted transition hover:bg-panel3 hover:text-slate-100"
          onClick={() => {
            void bridge.windowControls.toggleMaximize().then(setMaximized);
          }}
          title={maximized ? 'Восстановить' : 'Развернуть'}
          aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'}
        >
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="flex w-11 items-center justify-center text-muted transition hover:bg-danger hover:text-white"
          onClick={() => void bridge.windowControls.close()}
          title="Закрыть"
          aria-label="Закрыть окно"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
