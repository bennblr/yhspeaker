import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';

const styles = {
  ok: {
    icon: CheckCircle2,
    border: 'border-ok/30',
    iconColor: 'text-ok',
  },
  error: {
    icon: AlertCircle,
    border: 'border-danger/30',
    iconColor: 'text-danger',
  },
  info: {
    icon: Info,
    border: 'border-accent/30',
    iconColor: 'text-accent',
  },
};

export function Toasts() {
  const toasts = useApp((state) => state.toasts);
  const dismiss = useApp((state) => state.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const style = styles[toast.type];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex animate-rise items-start gap-3 rounded-xl border bg-[#111520]/95 p-3.5 shadow-panel backdrop-blur',
              style.border,
            )}
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconColor)} />
            <p className="flex-1 text-sm leading-snug text-slate-200">{toast.text}</p>
            <button
              onClick={() => dismiss(toast.id)}
              className="rounded p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
              aria-label="Закрыть"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
