import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Maximize2, Minimize2, Minus, Plus, Radio, Server, X } from 'lucide-react';
import { desktop, type DesktopServerInfo } from '../lib/desktop';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function DesktopTitleBar({ serverName }: { serverName: string }) {
  const bridge = desktop;
  const connection = useApp((state) => state.connection);
  const me = useApp((state) => state.me);
  const [maximized, setMaximized] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const [serverList, setServerList] = useState<DesktopServerInfo[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!serversOpen) return;
    setSwitchError(null);
    void desktop?.listServers().then(setServerList);
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setServersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setServersOpen(false);
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
    };
  }, [serversOpen]);

  if (!bridge) return null;
  const appBridge = bridge;

  const switchTo = (url: string) => {
    if (switching) return;
    setSwitching(url);
    setSwitchError(null);
    void appBridge
      .switchServer(url)
      .then((result) => {
        if (!result.ok) {
          setSwitching(null);
          setSwitchError(result.error ?? 'Не удалось переключиться на сервер.');
        }
      })
      .catch(() => {
        setSwitching(null);
        setSwitchError('Не удалось переключиться на сервер.');
      });
  };

  return (
    <header className="app-drag flex h-9 shrink-0 select-none items-center gap-2 border-b border-line bg-[#090b10] pl-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent2">
          <Radio className="h-3 w-3 text-white" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
          LA2Speak
        </span>
        {serverName !== 'LA2Speak' && (
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

      <div className="app-no-drag relative ml-auto flex h-full items-stretch" ref={menuRef}>
        <button
          type="button"
          className={cn(
            'flex h-full items-center gap-1.5 px-3 text-[11px] text-muted transition hover:bg-panel3 hover:text-slate-200',
            serversOpen && 'bg-panel3 text-slate-200',
          )}
          onClick={() => setServersOpen((value) => !value)}
          title="Серверы"
          aria-haspopup="menu"
          aria-expanded={serversOpen}
        >
          <Server className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Сервер</span>
        </button>
        <div className="my-2 w-px bg-line" />
        <button
          type="button"
          className="flex w-11 items-center justify-center text-muted transition hover:bg-panel3 hover:text-slate-100"
          onClick={() => void appBridge.windowControls.minimize()}
          title="Свернуть"
          aria-label="Свернуть окно"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex w-11 items-center justify-center text-muted transition hover:bg-panel3 hover:text-slate-100"
          onClick={() => {
            void appBridge.windowControls.toggleMaximize().then(setMaximized);
          }}
          title={maximized ? 'Восстановить' : 'Развернуть'}
          aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'}
        >
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="flex w-11 items-center justify-center text-muted transition hover:bg-danger hover:text-white"
          onClick={() => void appBridge.windowControls.close()}
          title="Закрыть"
          aria-label="Закрыть окно"
        >
          <X className="h-4 w-4" />
        </button>

        {serversOpen && (
          <div
            role="menu"
            className="app-no-drag absolute right-2 top-full z-50 w-80 rounded-xl border border-line bg-panel p-1.5 shadow-panel"
          >
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              Мои серверы
            </div>
            <div className="max-h-72 overflow-y-auto">
              {serverList.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-muted">Пока нет посещённых серверов.</div>
              )}
              {serverList.map((server) => (
                <button
                  key={server.url}
                  type="button"
                  role="menuitem"
                  disabled={Boolean(switching)}
                  onClick={() => {
                    if (server.current) {
                      setServersOpen(false);
                      return;
                    }
                    switchTo(server.url);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition',
                    'hover:bg-panel3 disabled:cursor-wait',
                    server.current && 'bg-panel3/60',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      server.current ? 'bg-ok' : 'bg-accent/70',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-slate-200">
                      {server.name || hostOf(server.url)}
                    </span>
                    {server.name && (
                      <span className="block truncate text-[10px] text-muted">
                        {hostOf(server.url)}
                      </span>
                    )}
                  </span>
                  {switching === server.url ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  ) : server.current ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
                  ) : null}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-line" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12px] text-slate-300 transition hover:bg-panel3 hover:text-slate-100"
              onClick={() => {
                setServersOpen(false);
                void appBridge.changeServer();
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить сервер…
            </button>
            {switchError && (
              <div className="px-2 pb-1 pt-1 text-[11px] leading-relaxed text-danger">
                {switchError}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
