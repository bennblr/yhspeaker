import { useEffect, useState } from 'react';
import { AppWindow, Loader2, Monitor, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { desktop, type DesktopScreenSource } from '../lib/desktop';
import { closeScreenSharePicker, useScreenSharePickerOpen } from '../lib/screenPicker';
import { toast } from '../lib/actions';
import { voice } from '../lib/voice';
import { cn } from '../lib/utils';

type SourceKind = DesktopScreenSource['kind'];

const TABS: { kind: SourceKind; label: string; icon: typeof Monitor }[] = [
  { kind: 'screen', label: 'Экраны', icon: Monitor },
  { kind: 'window', label: 'Окна', icon: AppWindow },
];

export function ScreenSharePicker() {
  const open = useScreenSharePickerOpen();
  const [tab, setTab] = useState<SourceKind>('screen');
  const [sources, setSources] = useState<DesktopScreenSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    const load = desktop?.getScreenSources;
    if (!load) {
      setError('Выбор источника доступен в приложении LA2Speak версии 1.0.10 и новее.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch((reason) => {
        console.error('[screen] source list failed', reason);
        if (!cancelled) setError('Не удалось получить список экранов и окон.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  useEffect(() => {
    if (open) setBusyId(null);
    else setTab('screen');
  }, [open]);

  async function pick(source: DesktopScreenSource): Promise<void> {
    if (busyId) return;
    setBusyId(source.id);
    try {
      const selected = await desktop?.selectScreenSource?.(source.id);
      if (!selected) throw new Error('source not selected');
      closeScreenSharePicker();
      await voice.startScreenShare();
    } catch (reason) {
      console.error('[screen] share start failed', reason);
      toast('error', 'Не удалось начать демонстрацию');
    } finally {
      setBusyId(null);
    }
  }

  const visible = sources.filter((source) => source.kind === tab);
  const counts: Record<SourceKind, number> = {
    screen: sources.filter((source) => source.kind === 'screen').length,
    window: sources.filter((source) => source.kind === 'window').length,
  };

  return (
    <Modal
      open={open}
      onClose={closeScreenSharePicker}
      title="Что показать"
      subtitle="Выберите экран целиком или отдельное окно."
      width="max-w-3xl"
      footer={
        <p className="text-[11px] leading-relaxed text-muted">
          В списке только окна, открытые сейчас. Чтобы появилось новое окно, сверните игру или
          приложение и нажмите «Обновить». Показ можно остановить кнопкой «Остановить показ».
        </p>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => setTab(kind)}
              className={cn(
                'btn h-8 gap-1.5 px-3 text-xs',
                tab === kind
                  ? 'bg-accent/15 text-accent'
                  : 'bg-panel3 text-muted hover:text-slate-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {counts[kind] > 0 && <span className="text-[10px] opacity-70">{counts[kind]}</span>}
            </button>
          ))}
          <button
            type="button"
            className="btn-ghost ml-auto h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Обновить
          </button>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        {loading && sources.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Собираем список экранов и окон…
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line py-16 text-center text-xs text-muted">
            {tab === 'screen'
              ? 'Экраны не найдены. Попробуйте обновить список.'
              : 'Нет открытых окон. Запустите игру или приложение и обновите список.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visible.map((source) => (
              <button
                key={source.id}
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void pick(source)}
                className={cn(
                  'group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-panel text-left transition',
                  busyId === source.id
                    ? 'border-accent/70 ring-2 ring-accent/30'
                    : 'border-line hover:border-accent/60',
                  busyId && busyId !== source.id && 'opacity-60',
                )}
              >
                <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black/50">
                  {source.thumbnail ? (
                    <img
                      src={source.thumbnail}
                      alt=""
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <Monitor className="h-7 w-7 text-muted" />
                  )}
                  {busyId === source.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="h-5 w-5 animate-spin text-accent" />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                  {source.kind === 'window' && source.appIcon ? (
                    <img src={source.appIcon} alt="" className="h-4 w-4 shrink-0 rounded" />
                  ) : source.kind === 'window' ? (
                    <AppWindow className="h-4 w-4 shrink-0 text-muted" />
                  ) : (
                    <Monitor className="h-4 w-4 shrink-0 text-muted" />
                  )}
                  <span className="truncate text-xs text-slate-200" title={source.name}>
                    {source.name}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
