import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BarChart3,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Globe2,
  KeyRound,
  Loader2,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { OnlineStatsSummary } from '@tsds/shared';
import { Modal } from '../Modal';
import {
  PlatformApiError,
  loadPlatformToken,
  platformApi,
  savePlatformToken,
  type PlatformMeta,
  type PlatformOverview,
  type PlatformServer,
  type PlatformStatus,
  type TenantCredentials,
} from '../../lib/platformApi';

const STATUS: Record<PlatformStatus, { label: string; className: string; dot: string }> = {
  running: {
    label: 'Работает',
    className: 'border-ok/20 bg-ok/10 text-ok',
    dot: 'bg-ok',
  },
  starting: {
    label: 'Запускается',
    className: 'border-warn/20 bg-warn/10 text-warn',
    dot: 'bg-warn animate-pulse',
  },
  stopped: {
    label: 'Остановлен',
    className: 'border-line bg-panel3 text-muted',
    dot: 'bg-muted',
  },
  error: {
    label: 'Ошибка',
    className: 'border-danger/20 bg-danger/10 text-danger',
    dot: 'bg-danger',
  },
};

function parseParticipants(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.min(150, Math.max(1, parsed));
}

function validParticipants(value: string): boolean {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 150;
}

function parseDomains(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}

function publicUrl(domain: string): string {
  const port =
    window.location.port && !['80', '443'].includes(window.location.port)
      ? `:${window.location.port}`
      : '';
  return `${window.location.protocol}//${domain}${port}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${total} с`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: PlatformStatus }) {
  const info = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        info.className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', info.dot)} />
      {info.label}
    </span>
  );
}

function CopyButton({
  value,
  label,
  onCopied,
  copied,
}: {
  value: string;
  label: string;
  copied: boolean;
  onCopied: () => void;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn h-8 w-8 shrink-0"
      title={done || copied ? 'Скопировано' : `Скопировать ${label}`}
      aria-label={`Скопировать ${label}`}
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          onCopied();
          window.setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function CredentialRow({
  label,
  value,
  copied,
  onCopied,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopied: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate font-mono text-sm text-slate-100">{value}</p>
      </div>
      <CopyButton value={value} label={label} copied={copied} onCopied={onCopied} />
    </div>
  );
}

export function PlatformApp() {
  const [token, setToken] = useState<string | null>(() => loadPlatformToken());
  const [admin, setAdmin] = useState<string | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [booting, setBooting] = useState(Boolean(token));
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDomains, setCreateDomains] = useState('');
  const [createParticipants, setCreateParticipants] = useState('50');
  const [createLogin, setCreateLogin] = useState('admin');
  const [createPassword, setCreatePassword] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const [editing, setEditing] = useState<PlatformServer | null>(null);
  const [editName, setEditName] = useState('');
  const [editDomains, setEditDomains] = useState<string[]>([]);
  const [editParticipants, setEditParticipants] = useState('50');
  const [editBusy, setEditBusy] = useState(false);

  const [credentialsFor, setCredentialsFor] = useState<PlatformServer | null>(null);
  const [credentials, setCredentials] = useState<TenantCredentials | null>(null);
  const [credentialsFresh, setCredentialsFresh] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(false);

  const [deleting, setDeleting] = useState<PlatformServer | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const [statsFor, setStatsFor] = useState<PlatformServer | null>(null);
  const [statsDays, setStatsDays] = useState(7);
  const [statsData, setStatsData] = useState<OnlineStatsSummary | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const servers = overview?.servers ?? [];
  const meta: PlatformMeta | null = overview?.meta ?? null;

  const stats = useMemo(() => {
    const running = servers.filter((server) => server.status === 'running').length;
    const domains = servers.reduce((sum, server) => sum + server.domains.length, 0);
    const places = servers.reduce((sum, server) => sum + server.maxParticipants, 0);
    const rtcUsed = servers.reduce(
      (sum, server) => sum + (server.rtcMaxPort - server.rtcMinPort + 1),
      0,
    );
    const rtcTotal = meta ? meta.rtcPoolEnd - meta.rtcPoolStart + 1 : 0;
    return {
      total: servers.length,
      running,
      domains,
      places,
      rtcFree: Math.max(0, rtcTotal - rtcUsed),
      rtcTotal,
    };
  }, [servers, meta]);

  const editRestartNeeded = Boolean(
    editing &&
      (editing.name !== editName.trim() ||
        Number.parseInt(editParticipants, 10) !== editing.maxParticipants),
  );

  const logout = useCallback(() => {
    savePlatformToken(null);
    setToken(null);
    setAdmin(null);
    setOverview(null);
    setBooting(false);
    setCredentials(null);
    setCredentialsFor(null);
  }, []);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!token) return;
      if (showSpinner) setRefreshing(true);
      try {
        const data = await platformApi.overview(token);
        setOverview(data);
        setAdmin(data.meta.adminLogin);
      } catch (error) {
        if (error instanceof PlatformApiError && error.status === 401) {
          logout();
          return;
        }
        setNotice({ kind: 'error', text: errorText(error) });
      } finally {
        if (showSpinner) setRefreshing(false);
        setBooting(false);
      }
    },
    [token, logout],
  );

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }
    void load();
  }, [token, load]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [token, load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function submitLogin(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      const result = await platformApi.login(loginName.trim(), loginPassword);
      savePlatformToken(result.token);
      setToken(result.token);
      setAdmin(result.admin.login);
      setLoginPassword('');
      setBooting(true);
    } catch (error) {
      setLoginError(errorText(error));
    } finally {
      setLoginBusy(false);
    }
  }

  async function runAction(key: string, action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      setNotice({ kind: 'ok', text: success });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  }

  function openCreate(): void {
    setCreateName('');
    setCreateDomains('');
    setCreateParticipants(String(meta?.defaultMaxParticipants ?? 50));
    setCreateLogin('admin');
    setCreatePassword('');
    setCreateOpen(true);
  }

  async function submitCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token || createBusy) return;
    setCreateBusy(true);
    try {
      const result = await platformApi.createServer(token, {
        name: createName.trim(),
        domains: parseDomains(createDomains),
        maxParticipants: parseParticipants(createParticipants),
        adminLogin: createLogin.trim() || undefined,
        adminPassword: createPassword || undefined,
      });
      setCreateOpen(false);
      setCredentials(result.credentials);
      setCredentialsFor(result.server);
      setCredentialsFresh(true);
      setNotice({ kind: 'ok', text: `Сервер «${result.server.name}» создан` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
    } finally {
      setCreateBusy(false);
    }
  }

  function openEdit(server: PlatformServer): void {
    setEditing(server);
    setEditName(server.name);
    setEditDomains(server.domains.length ? [...server.domains] : ['']);
    setEditParticipants(String(server.maxParticipants));
  }

  async function submitEdit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token || !editing || editBusy) return;
    setEditBusy(true);
    try {
      await platformApi.updateServer(token, editing.id, {
        name: editName.trim(),
        domains: editDomains.map((domain) => domain.trim()).filter(Boolean),
        maxParticipants: parseParticipants(editParticipants),
      });
      setEditing(null);
      setNotice({ kind: 'ok', text: 'Настройки сервера сохранены' });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
    } finally {
      setEditBusy(false);
    }
  }

  async function openCredentials(server: PlatformServer): Promise<void> {
    if (!token) return;
    setCredentialsFor(server);
    setCredentials(null);
    setCredentialsFresh(false);
    setCredentialsLoading(true);
    try {
      setCredentials(await platformApi.credentials(token, server.id));
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
      setCredentialsFor(null);
    } finally {
      setCredentialsLoading(false);
    }
  }

  useEffect(() => {
    if (!statsFor || !token) return;
    let cancelled = false;
    setStatsLoading(true);
    platformApi
      .stats(token, statsFor.id, statsDays)
      .then((result) => {
        if (!cancelled) setStatsData(result.stats);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: errorText(error) });
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statsFor, statsDays, token]);

  async function submitDelete(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token || !deleting || busy) return;
    const name = deleting.name;
    setBusy(`delete:${deleting.id}`);
    try {
      await platformApi.remove(token, deleting.id, deleteConfirm.trim());
      setDeleting(null);
      setDeleteConfirm('');
      setNotice({ kind: 'ok', text: `Сервер «${name}» удалён, данные отправлены в архив` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  }

  if (booting) {
    return (
      <div className="grid h-screen place-items-center bg-bg">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка платформы…
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="relative grid h-screen place-items-center overflow-y-auto bg-bg px-4">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-accent/15 blur-[100px]" />
          <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-accent2/10 blur-[120px]" />
        </div>
        <form
          onSubmit={submitLogin}
          className="relative w-full max-w-sm rounded-2xl border border-line bg-panel2 p-6 shadow-panel"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-100">YHSpeak Platform</h1>
              <p className="text-xs text-muted">Панель управления серверами</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div>
              <label className="label" htmlFor="platform-login">
                Логин
              </label>
              <input
                id="platform-login"
                className="input"
                autoComplete="username"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                placeholder="admin"
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="platform-password">
                Пароль
              </label>
              <input
                id="platform-password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          {loginError && (
            <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
              {loginError}
            </p>
          )}

          <button type="submit" className="btn-primary mt-5 w-full" disabled={loginBusy}>
            {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Войти в панель
          </button>
          <p className="mt-4 text-center text-[11px] text-muted">
            Платформа создаёт изолированные серверы с отдельными данными, портами и доменами.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">YHSpeak Platform</p>
              <p className="truncate text-[11px] text-muted">
                {admin} · v{meta?.version ?? '—'}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="icon-btn"
              title="Обновить"
              aria-label="Обновить"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-2 text-xs"
              onClick={logout}
              title="Выйти"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
            <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Новый сервер
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Серверы" value={String(stats.total)} />
          <Stat label="Работают" value={String(stats.running)} />
          <Stat label="Домены" value={String(stats.domains)} />
          <Stat label="Мест" value={String(stats.places)} hint="суммарно по серверам" />
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Серверы</h2>
            <p className="text-xs text-muted">
              Каждый сервер — отдельный процесс с собственными данными, JWT-секретом и портами.
            </p>
          </div>
          {meta && (
            <p className="text-[11px] text-muted">
              DNS: A-запись домена →{' '}
              <span className="font-mono text-slate-300">{meta.announcedIp}</span>
            </p>
          )}
        </div>

        {servers.length === 0 ? (
          <div className="mt-6 grid place-items-center rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent/10 text-accent">
              <Server className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-slate-200">Пока нет ни одного сервера</h3>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              Создайте первый сервер, привяжите домен и передайте администратору сервера логин и
              пароль.
            </p>
            <button type="button" className="btn-primary mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Создать сервер
            </button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {servers.map((server) => {
              const status = STATUS[server.status];
              const actionBusy = busy?.endsWith(`:${server.id}`) ?? false;
              return (
                <article key={server.id} className="card flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-panel3 text-accent">
                      <Server className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-100">
                          {server.name}
                        </h3>
                        <StatusBadge status={server.status} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted">
                        создан {formatDate(server.createdAt)} · {server.adminLogin}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted" />
                      {server.domains.length ? (
                        server.domains.map((domain) => (
                          <a
                            key={domain}
                            href={publicUrl(domain)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] text-slate-300 transition hover:border-accent/40 hover:text-accent"
                          >
                            {domain}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted">домен не привязан</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
                      HTTP {server.httpPort} · RTC {server.rtcMinPort}–{server.rtcMaxPort} · до{' '}
                      {server.maxParticipants} участников
                    </div>
                    {server.lastError && (
                      <p className="flex items-start gap-1.5 rounded-lg border border-danger/15 bg-danger/5 px-2 py-1.5 text-[11px] leading-snug text-danger">
                        <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0 break-words">{server.lastError}</span>
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                    {server.status === 'running' || server.status === 'starting' ? (
                      <button
                        type="button"
                        className="btn-ghost px-2.5 py-1.5 text-[11px]"
                        title="Остановить"
                        disabled={actionBusy}
                        onClick={() =>
                          void runAction(
                            `stop:${server.id}`,
                            () => platformApi.stop(token, server.id),
                            `Сервер «${server.name}» остановлен`,
                          )
                        }
                      >
                        {actionBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                        Стоп
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost px-2.5 py-1.5 text-[11px]"
                        title="Запустить"
                        disabled={actionBusy}
                        onClick={() =>
                          void runAction(
                            `start:${server.id}`,
                            () => platformApi.start(token, server.id),
                            `Запуск «${server.name}»`,
                          )
                        }
                      >
                        {actionBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        Запустить
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost px-2.5 py-1.5 text-[11px]"
                      title="Перезапустить"
                      disabled={actionBusy}
                      onClick={() =>
                        void runAction(
                          `restart:${server.id}`,
                          () => platformApi.restart(token, server.id),
                          `Перезапуск «${server.name}»`,
                        )
                      }
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Рестарт
                    </button>
                    <button
                      type="button"
                      className="icon-btn ml-auto h-8 w-8"
                      title="Статистика онлайна"
                      aria-label="Статистика онлайна"
                      onClick={() => {
                        setStatsData(null);
                        setStatsFor(server);
                      }}
                    >
                      <BarChart3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn h-8 w-8"
                      title="Логин и пароль администратора сервера"
                      aria-label="Доступ администратора"
                      onClick={() => void openCredentials(server)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn h-8 w-8"
                      title="Домены и название"
                      aria-label="Настройки сервера"
                      onClick={() => openEdit(server)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn h-8 w-8 hover:bg-danger/10 hover:text-danger"
                      title="Удалить сервер"
                      aria-label="Удалить сервер"
                      onClick={() => {
                        setDeleting(server);
                        setDeleteConfirm('');
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {meta && (
          <div className="mt-6 rounded-xl border border-line bg-panel/50 px-4 py-3 text-[11px] leading-relaxed text-muted">
            <p>
              Панель: <span className="font-mono text-slate-300">{meta.publicHost || 'не задан'}</span>.
              Для каждого домена создайте A-запись на <span className="font-mono text-slate-300">{meta.announcedIp}</span> —
              HTTPS-сертификат Caddy выпустит автоматически после привязки домена в панели.
            </p>
            <p className="mt-1">
              Пул портов: HTTP {meta.httpPortStart}–{meta.httpPortEnd}, RTC {meta.rtcPoolStart}–
              {meta.rtcPoolEnd}. Свободно RTC-портов: {stats.rtcFree} из {stats.rtcTotal}; на
              участника выделяется 2 порта.
            </p>
            <p className="mt-1">
              Лимит участников на сервер: от 1 до {meta.maxParticipantsLimit}, по умолчанию{' '}
              {meta.defaultMaxParticipants}.
            </p>
          </div>
        )}
      </main>

      <Modal
        open={createOpen}
        onClose={() => !createBusy && setCreateOpen(false)}
        title="Новый сервер"
        subtitle="Отдельный процесс, данные, JWT-секрет, порты и лимит участников"
        width="max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setCreateOpen(false)}
              disabled={createBusy}
            >
              Отмена
            </button>
            <button
              type="submit"
              form="platform-create-form"
              className="btn-primary"
              disabled={createBusy || createName.trim().length < 2 || !validParticipants(createParticipants)}
            >
              {createBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Создать сервер
            </button>
          </div>
        }
      >
        <form id="platform-create-form" className="space-y-4" onSubmit={submitCreate}>
          <div>
            <label className="label" htmlFor="create-name">
              Название сервера
            </label>
            <input
              id="create-name"
              className="input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Например, Команда Alpha"
              maxLength={48}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="create-domains">
              Домены
            </label>
            <textarea
              id="create-domains"
              className="input min-h-[86px] resize-y"
              value={createDomains}
              onChange={(event) => setCreateDomains(event.target.value)}
              placeholder={'alpha.example.com\nchat.alpha.example.com'}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {meta?.tenantDomainSuffix
                ? `Можно оставить пустым — домен создастся автоматически на основе названия (суффикс ${meta.tenantDomainSuffix}). `
                : 'По одному домену в строке. '}
              A-запись каждого домена должна указывать на{' '}
              <span className="font-mono text-slate-300">{meta?.announcedIp ?? 'ANNOUNCED_IP'}</span>.
              Можно добавить позже.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="create-participants">
              Участников
            </label>
            <input
              id="create-participants"
              type="number"
              className="input"
              value={createParticipants}
              onChange={(event) => setCreateParticipants(event.target.value)}
              min={1}
              max={meta?.maxParticipantsLimit ?? 150}
              step={1}
              required
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              До {meta?.maxParticipantsLimit ?? 150} одновременных голосовых участников. Каждому
              выделяется 2 RTC-порта, поэтому от лимита зависит остаток пула.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="create-login">
                Логин администратора
              </label>
              <input
                id="create-login"
                className="input"
                value={createLogin}
                onChange={(event) => setCreateLogin(event.target.value)}
                maxLength={32}
              />
            </div>
            <div>
              <label className="label" htmlFor="create-password">
                Пароль администратора
              </label>
              <input
                id="create-password"
                className="input"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
                placeholder="Сгенерировать"
                minLength={8}
                maxLength={100}
              />
            </div>
          </div>
          <p className="rounded-lg border border-line bg-panel px-3 py-2 text-[11px] leading-relaxed text-muted">
            Логин и пароль будут показаны один раз после создания. Их можно снова открыть в панели:
            пароль хранится в зашифрованном виде.
          </p>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => !editBusy && setEditing(null)}
        title={editing ? `Настройки «${editing.name}»` : 'Настройки сервера'}
        subtitle="Название, домены и лимит участников; изменения применяются после перезапуска"
        width="max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditing(null)}
              disabled={editBusy}
            >
              Отмена
            </button>
            <button
              type="submit"
              form="platform-edit-form"
              className="btn-primary"
              disabled={editBusy || editName.trim().length < 2 || !validParticipants(editParticipants)}
            >
              {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Сохранить
            </button>
          </div>
        }
      >
        <form id="platform-edit-form" className="space-y-4" onSubmit={submitEdit}>
          <div>
            <label className="label" htmlFor="edit-name">
              Название
            </label>
            <input
              id="edit-name"
              className="input"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              maxLength={48}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-participants">
              Участников
            </label>
            <input
              id="edit-participants"
              type="number"
              className="input"
              value={editParticipants}
              onChange={(event) => setEditParticipants(event.target.value)}
              min={1}
              max={meta?.maxParticipantsLimit ?? 150}
              step={1}
              required
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              До {meta?.maxParticipantsLimit ?? 150} человек. Новый лимит пересчитает диапазон RTC:
              2 порта на участника.
            </p>
            {editRestartNeeded &&
              (editing?.status === 'running' || editing?.status === 'starting') && (
                <p className="mt-1 text-[11px] text-warn">
                  После сохранения сервер перезапустится, чтобы применить название и лимит
                  участников.
                </p>
              )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="label mb-0">Домены</span>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-[11px]"
                onClick={() => setEditDomains((items) => [...items, ''])}
              >
                <Plus className="h-3 w-3" />
                Добавить
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {editDomains.length === 0 && (
                <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-muted">
                  Домен не привязан — сервер будет недоступен по внешнему адресу.
                </p>
              )}
              {editDomains.map((domain, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="input py-2"
                    value={domain}
                    placeholder="chat.example.com"
                    onChange={(event) =>
                      setEditDomains((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn h-9 w-9 shrink-0"
                    title="Убрать домен"
                    aria-label="Убрать домен"
                    onClick={() =>
                      setEditDomains((items) => items.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              A-запись домена → <span className="font-mono text-slate-300">{meta?.announcedIp}</span>.
              Домен нельзя привязать к двум серверам одновременно.
            </p>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(credentialsFor)}
        onClose={() => {
          setCredentialsFor(null);
          setCredentials(null);
        }}
        title={credentialsFresh ? 'Сервер создан' : 'Доступ администратора'}
        subtitle={credentialsFor?.name}
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCredentialsFor(null);
                setCredentials(null);
              }}
            >
              Закрыть
            </button>
          </div>
        }
      >
        {credentialsLoading || !credentials ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка данных…
          </div>
        ) : (
          <div className="space-y-3">
            <CredentialRow
              label="Логин"
              value={credentials.login}
              copied={false}
              onCopied={() => setNotice({ kind: 'ok', text: 'Логин скопирован' })}
            />
            <CredentialRow
              label="Пароль"
              value={credentials.password}
              copied={false}
              onCopied={() => setNotice({ kind: 'ok', text: 'Пароль скопирован' })}
            />
            <p className="text-[11px] leading-relaxed text-muted">
              Передайте эти данные администратору сервера. Он сможет войти на{' '}
              {credentialsFor?.domains[0] ? (
                <a
                  href={publicUrl(credentialsFor.domains[0])}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {credentialsFor.domains[0]}
                </a>
              ) : (
                'привязанный домен'
              )}{' '}
              и управлять каналами, ролями и гостями.
            </p>
            {credentialsFresh && (
              <p className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-warn">
                Сохраните пароль сейчас. Позже его можно снова открыть здесь — платформа хранит его
                в зашифрованном виде.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(statsFor)}
        onClose={() => setStatsFor(null)}
        title={statsFor ? `Статистика «${statsFor.name}»` : 'Статистика'}
        subtitle="Пиковый, средний и суммарный онлайн за выбранный период"
        width="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {[1, 7, 30, 90].map((days) => (
              <button
                key={days}
                className={cn(
                  'btn-ghost h-8 px-3 text-xs',
                  statsDays === days && 'border-accent/40 bg-accent/10 text-accent',
                )}
                onClick={() => setStatsDays(days)}
                disabled={statsLoading}
              >
                {days === 1 ? 'Сутки' : `${days} дней`}
              </button>
            ))}
            <button
              className="icon-btn ml-auto h-8 w-8"
              title="Обновить"
              onClick={() => {
                const current = statsFor;
                if (!current || !token) return;
                setStatsLoading(true);
                platformApi
                  .stats(token, current.id, statsDays)
                  .then((result) => setStatsData(result.stats))
                  .catch((error: unknown) =>
                    setNotice({ kind: 'error', text: errorText(error) }),
                  )
                  .finally(() => setStatsLoading(false));
              }}
              disabled={statsLoading}
            >
              <RefreshCw className={cn('h-4 w-4', statsLoading && 'animate-spin')} />
            </button>
          </div>

          {!statsData ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Пиковый онлайн" value={String(statsData.peak)} />
                <Stat label="Средний онлайн" value={statsData.average.toFixed(1)} />
                <Stat label="Участников" value={String(statsData.uniqueUsers)} />
                <Stat label="Суммарный онлайн" value={formatDuration(statsData.totalSeconds)} />
              </div>

              <div className="rounded-xl border border-line bg-panel/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <BarChart3 className="h-3.5 w-3.5 text-accent" />
                    Средний онлайн по времени
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    интервал {Math.round(statsData.bucketMs / 3_600_000)} ч
                  </span>
                </div>
                {statsData.timeline.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted">
                    Данных пока нет — статистика собирается каждые 30 секунд.
                  </p>
                ) : (
                  <div className="flex h-32 items-end gap-[2px] overflow-x-auto">
                    {statsData.timeline.map((point) => (
                      <div
                        key={point.t}
                        className="min-w-[5px] flex-1 rounded-t bg-accent/70 transition hover:bg-accent"
                        style={{
                          height: `${Math.max(2, (point.avg / Math.max(1, statsData.peak)) * 100)}%`,
                        }}
                        title={`${new Date(point.t).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })} · средний ${point.avg.toFixed(1)}, пик ${point.peak}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-panel3/60 text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3 py-2">День</th>
                      <th className="px-3 py-2">Пик</th>
                      <th className="px-3 py-2">Средний</th>
                      <th className="px-3 py-2">Участников</th>
                      <th className="px-3 py-2">Онлайн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.daily.map((day) => (
                      <tr key={day.date} className="border-t border-line/60">
                        <td className="px-3 py-1.5 text-slate-300">{day.date}</td>
                        <td className="px-3 py-1.5 text-slate-200">{day.peak}</td>
                        <td className="px-3 py-1.5 text-slate-200">{day.average.toFixed(1)}</td>
                        <td className="px-3 py-1.5 text-slate-200">{day.users}</td>
                        <td className="px-3 py-1.5 text-slate-200">
                          {formatDuration(day.seconds)}
                        </td>
                      </tr>
                    ))}
                    {statsData.daily.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-muted">
                          Нет данных за период
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-panel3/60 text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3 py-2">Участник</th>
                      <th className="px-3 py-2">Время в сети</th>
                      <th className="px-3 py-2">Сессий</th>
                      <th className="px-3 py-2">Был(а)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.users.map((user) => (
                      <tr key={user.userId} className="border-t border-line/60">
                        <td className="px-3 py-1.5 text-slate-300">
                          {user.displayName}
                          {user.guest && (
                            <span className="ml-1.5 rounded bg-amber-400/10 px-1 py-0.5 text-[9px] uppercase text-amber-300">
                              гость
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-200">
                          {formatDuration(user.seconds)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-200">{user.sessions}</td>
                        <td className="px-3 py-1.5 text-muted">
                          {new Date(user.lastSeen).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                    {statsData.users.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted">
                          Нет данных об участниках
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => !busy && setDeleting(null)}
        title="Удалить сервер?"
        subtitle={deleting ? `«${deleting.name}»` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleting(null)}>
              Отмена
            </button>
            <button
              type="submit"
              form="platform-delete-form"
              className="btn-danger"
              disabled={!deleting || deleteConfirm.trim() !== deleting.name || Boolean(busy)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить сервер
            </button>
          </div>
        }
      >
        <form id="platform-delete-form" className="space-y-3" onSubmit={submitDelete}>
          <p className="text-sm leading-relaxed text-slate-300">
            Сервер будет остановлен, а его данные и логи перемещены в архив платформы. Домены
            освободятся и их можно будет привязать к другому серверу.
          </p>
          <div>
            <label className="label" htmlFor="delete-confirm">
              Введите название сервера для подтверждения
            </label>
            <input
              id="delete-confirm"
              className="input"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder={deleting?.name}
              autoFocus
            />
          </div>
        </form>
      </Modal>

      {notice && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[70] max-w-sm">
          <div
            className={cn(
              'animate-rise rounded-xl border px-3.5 py-2.5 text-xs shadow-panel',
              notice.kind === 'ok'
                ? 'border-ok/25 bg-[#0f1f1a] text-ok'
                : 'border-danger/25 bg-[#241016] text-danger',
            )}
          >
            {notice.text}
          </div>
        </div>
      )}
    </div>
  );
}
