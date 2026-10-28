import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Headphones,
  KeyRound,
  Loader2,
  MonitorUp,
  Radio,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, type PublicServerConfig } from '../lib/api';
import { loginWithToken } from '../lib/actions';
import { cn, serverLabel } from '../lib/utils';

type Tab = 'login' | 'register' | 'guest';

export function AuthScreen({ config }: { config: PublicServerConfig | null }) {
  const [guestCode] = useState(
    () => new URLSearchParams(window.location.search).get('guest')?.trim() ?? '',
  );
  const [linkDismissed, setLinkDismissed] = useState(false);
  const guestLink = guestCode.length > 0 && !linkDismissed;
  const [tab, setTab] = useState<Tab>(guestCode.length > 0 ? 'guest' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverName = serverLabel(config?.serverName);
  const allowGuests = config?.allowGuests ?? true;
  const inviteRequired = config?.guestInviteRequired ?? false;
  const guestDisabled = guestLink && config !== null && !allowGuests;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || guestDisabled) return;
    setError(null);
    setBusy(true);
    try {
      let result: { token: string };
      if (tab === 'login') {
        result = await api.login(username, password);
      } else if (tab === 'register') {
        result = await api.register(username, password, displayName || undefined);
      } else {
        result = await api.guest(
          displayName,
          inviteRequired ? (guestLink ? guestCode : inviteCode) : undefined,
        );
      }
      loginWithToken(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить вход');
    } finally {
      setBusy(false);
    }
  }

  function switchTab(next: Tab) {
    setTab(next);
    setError(null);
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-accent2/15 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative z-10 grid w-full max-w-4xl overflow-hidden rounded-3xl border border-line bg-panel/90 shadow-panel backdrop-blur md:grid-cols-[1.05fr_1fr]">
        <div className="hidden flex-col justify-between gap-10 border-r border-line bg-gradient-to-br from-[#151a2b] via-panel2 to-[#10131c] p-8 md:flex">
          <div>
            <div className="mb-7 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 shadow-glow">
                <Radio className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-lg font-bold tracking-wide text-white">{serverName}</div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted">
                  self-hosted voice
                </div>
              </div>
            </div>
            <h1 className="text-3xl font-bold leading-tight text-white">
              Своя голосовая
              <br />
              <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">
                команда
              </span>
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
              Каналы, текст, демонстрация экрана и мгновенное вещание администратора во все
              каналы — на вашем собственном сервере.
            </p>
          </div>

          <div className="space-y-3">
            {[
              { icon: Headphones, text: 'Голосовые каналы с низкой задержкой (SFU)' },
              { icon: Users, text: 'До 150 участников на одном сервере' },
              { icon: MonitorUp, text: 'Демонстрация экрана без сторонних сервисов' },
              { icon: Radio, text: 'Админ говорит сразу во все каналы' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel3 text-accent">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-ok" />
            Данные и голос остаются на вашем сервере
          </div>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3 md:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2">
              <Radio className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-white">{serverName}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted">voice server</div>
            </div>
          </div>

          {guestLink ? (
            <div className="mb-6">
              <div className="text-lg font-bold text-white">
                {inviteRequired ? 'Вход по приглашению' : 'Гостевой вход'}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {inviteRequired
                  ? 'Введите имя — регистрация не нужна.'
                  : 'Введите имя — код приглашения не требуется.'}{' '}
                Сначала вам доступен только гостевой канал; администратор может открыть остальные
                каналы.
              </p>
              {guestDisabled && (
                <p className="mt-3 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-warn">
                  Гостевой вход отключён на этом сервере.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setLinkDismissed(true);
                      switchTab('login');
                    }}
                  >
                    Войти с аккаунтом
                  </button>
                </p>
              )}
            </div>
          ) : (
            <div className="mb-6 flex rounded-xl border border-line bg-panel p-1">
              <TabButton active={tab === 'login'} onClick={() => switchTab('login')} icon={KeyRound}>
                Вход
              </TabButton>
              <TabButton
                active={tab === 'register'}
                onClick={() => switchTab('register')}
                icon={UserPlus}
              >
                Регистрация
              </TabButton>
              {allowGuests && (
                <TabButton active={tab === 'guest'} onClick={() => switchTab('guest')} icon={Users}>
                  Гость
                </TabButton>
              )}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {tab !== 'guest' && (
              <div>
                <label className="label" htmlFor="username">
                  Логин
                </label>
                <input
                  id="username"
                  className="input"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="например, alex"
                  required
                  minLength={3}
                  maxLength={24}
                />
              </div>
            )}

            {tab === 'guest' && (
              <>
                <div>
                  <label className="label" htmlFor="guest-name">
                    Ваше имя
                  </label>
                  <input
                    id="guest-name"
                    className="input"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Как вас зовут"
                    required
                    minLength={2}
                    maxLength={32}
                  />
                </div>
                {inviteRequired && !guestLink && (
                  <div>
                    <label className="label" htmlFor="invite">
                      Код приглашения
                    </label>
                    <input
                      id="invite"
                      className="input font-mono tracking-wider"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                      placeholder="например, a1b2c3d4"
                      required
                    />
                  </div>
                )}
              </>
            )}

            {tab !== 'guest' && (
              <div>
                <label className="label" htmlFor="password">
                  Пароль
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={tab === 'register' ? 'минимум 6 символов' : '••••••••'}
                  required
                  minLength={tab === 'register' ? 6 : 1}
                />
              </div>
            )}

            {tab === 'register' && (
              <div>
                <label className="label" htmlFor="display-name">
                  Отображаемое имя <span className="normal-case tracking-normal">(необязательно)</span>
                </label>
                <input
                  id="display-name"
                  className="input"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Иван"
                  maxLength={32}
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}

            {tab === 'register' && (
              <p className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-relaxed text-slate-400">
                Первый зарегистрированный аккаунт получает права администратора, остальные —
                роль Гость. Администратор назначит роль Пользователь или Модератор.
              </p>
            )}

            {tab === 'guest' && !guestLink && (
              <p className="text-xs leading-relaxed text-muted">
                {inviteRequired
                  ? 'Код приглашения выдаёт администратор сервера.'
                  : 'Код приглашения не требуется — достаточно указать имя.'}{' '}
                Гость попадает в гостевой канал; остальные каналы откроет администратор или
                модератор.
              </p>
            )}

            <button
              type="submit"
              className="btn-primary h-11 w-full"
              disabled={busy || guestDisabled}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tab === 'register' ? (
                <UserPlus className="h-4 w-4" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {tab === 'login' ? 'Войти' : tab === 'register' ? 'Создать аккаунт' : 'Войти гостем'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof KeyRound;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition',
        active ? 'bg-accent text-white shadow' : 'text-muted hover:text-slate-200',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
