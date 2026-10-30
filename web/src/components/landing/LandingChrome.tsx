import { ArrowLeft, Download, LayoutDashboard, Mic, Send } from 'lucide-react';
import { cn } from '../../lib/utils';

export const TELEGRAM_URL = 'https://t.me/bennlr';
export const TELEGRAM_HANDLE = '@bennlr';
export const DOWNLOAD_URL = '/download/windows';

export function Brand({ subtitle = 'голосовые серверы' }: { subtitle?: string }) {
  return (
    <a href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-white shadow-glow">
        <Mic className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide text-slate-100">LA2Speak</span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-muted">{subtitle}</span>
      </span>
    </a>
  );
}

export function TelegramLink({ label = 'Telegram', className }: { label?: string; className?: string }) {
  return (
    <a
      href={TELEGRAM_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-panel3 hover:text-slate-100',
        className,
      )}
    >
      <Send className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}

export function SiteHeader({ page }: { page: 'home' | 'guides' }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5">
        <Brand />
        {page === 'home' ? (
          <nav className="hidden items-center gap-1 text-xs text-muted md:flex">
            <a className="rounded-lg px-2.5 py-1.5 transition hover:bg-panel3 hover:text-slate-100" href="#features">
              Возможности
            </a>
            <a className="rounded-lg px-2.5 py-1.5 transition hover:bg-panel3 hover:text-slate-100" href="#how">
              Как это работает
            </a>
            <a className="rounded-lg px-2.5 py-1.5 transition hover:bg-panel3 hover:text-slate-100" href="#admins">
              Администраторам
            </a>
            <a className="rounded-lg px-2.5 py-1.5 transition hover:bg-panel3 hover:text-slate-100" href="/guides">
              Гайды
            </a>
          </nav>
        ) : (
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-panel3 hover:text-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            На главную
          </a>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <TelegramLink className="hidden sm:inline-flex" />
          <a href="/platform" className="btn-ghost h-9 px-3 text-xs">
            <LayoutDashboard className="h-3.5 w-3.5" />
            Панель
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-panel/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <Brand />
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Платформа голосовых и текстовых серверов. Каждый сервер живёт на своём домене со своими
            данными и участниками.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-xs">
          <a className="text-muted transition hover:text-slate-100" href="/guides">
            Гайды для администраторов
          </a>
          <a className="text-muted transition hover:text-slate-100" href="/platform">
            Панель управления
          </a>
          <a className="text-muted transition hover:text-slate-100" href={DOWNLOAD_URL}>
            <Download className="mr-1 inline h-3 w-3" />
            Клиент для Windows
          </a>
          <a
            className="text-muted transition hover:text-slate-100"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
          >
            Telegram {TELEGRAM_HANDLE}
          </a>
        </div>
      </div>
      <div className="border-t border-line/60 px-5 py-4 text-center text-[11px] text-muted">
        © {new Date().getFullYear()} LA2Speak
      </div>
    </footer>
  );
}
