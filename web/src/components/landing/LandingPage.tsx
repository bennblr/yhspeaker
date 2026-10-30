import {
  AudioLines,
  BookOpen,
  Gauge,
  Hash,
  Headphones,
  Lock,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
  Volume2,
  Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { SiteFooter, SiteHeader, TELEGRAM_URL } from './LandingChrome';

const FEATURES = [
  {
    icon: AudioLines,
    title: 'Живой голос без задержек',
    text: 'WebRTC через mediasoup, шумоподавление GTCRN и индикатор речи у каждого участника.',
  },
  {
    icon: MonitorUp,
    title: 'Демонстрация экрана',
    text: 'Покажите экран каналу или своей группе слушателей — тем же клиентом, без сторонних программ.',
  },
  {
    icon: Radio,
    title: 'Вещание администратора',
    text: 'Один говорит во все голосовые каналы, с приоритетом и режимом удержания клавиши.',
  },
  {
    icon: ShieldCheck,
    title: 'Роли и права',
    text: 'Гость, пользователь, модератор, админ плюс свой конструктор ролей: каналы, роли, модерация, приглашения.',
  },
  {
    icon: UserPlus,
    title: 'Гости по ссылке',
    text: 'Вход по нику, код приглашения и превращение гостя в постоянный аккаунт с логином и паролем.',
  },
  {
    icon: Zap,
    title: 'Клиент для Windows',
    text: 'Глобальные клавиши и боковые кнопки мыши работают даже в свёрнутом окне и поверх игры.',
  },
  {
    icon: Lock,
    title: 'Свои каналы и пароли',
    text: 'Голосовые и текстовые каналы, пароль на вход, видимость для гостей и перемещение участников.',
  },
  {
    icon: Users,
    title: 'Несколько устройств',
    text: 'Один аккаунт на компьютере и в браузере: сессии и устройства видны администратору.',
  },
  {
    icon: Gauge,
    title: 'Статистика онлайна',
    text: 'Пиковый и средний онлайн по дням, время участников в сети и кто заходил последним.',
  },
];

function PreviewTile({
  name,
  initial,
  speaking,
  broadcasting,
  muted,
  admin,
}: {
  name: string;
  initial: string;
  speaking?: boolean;
  broadcasting?: boolean;
  muted?: boolean;
  admin?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2.5',
        speaking ? 'border-ok/40 bg-ok/[0.06]' : 'border-line bg-panel2/80',
      )}
    >
      {broadcasting && (
        <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-ok/15 px-1 text-[7px] font-bold uppercase tracking-wide text-ok">
          <Radio className="h-2 w-2" />
          эфир
        </span>
      )}
      <span
        className={cn(
          'grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold text-slate-100',
          speaking ? 'bg-ok/30 ring-2 ring-ok/60' : 'bg-panel3',
        )}
      >
        {initial}
      </span>
      <span className="flex max-w-full items-center gap-1 text-[9px] font-semibold text-slate-200">
        <span className="truncate">{name}</span>
        {admin && <ShieldCheck className="h-2.5 w-2.5 shrink-0 text-accent" />}
      </span>
      <span className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-muted">
        {muted ? <MicOff className="h-2.5 w-2.5 text-danger" /> : <Mic className="h-2.5 w-2.5" />}
        {muted ? 'выкл' : speaking ? 'говорит' : 'в канале'}
      </span>
    </div>
  );
}

function AppPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="absolute -inset-6 rounded-[36px] bg-accent/15 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel2 shadow-panel">
        <div className="flex items-center gap-1.5 border-b border-line bg-[#0d1017] px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
          <span className="ml-2 truncate text-[10px] text-muted">team.example.com</span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />3 в сети
          </span>
        </div>
        <div className="grid grid-cols-[132px_1fr]">
          <div className="border-r border-line bg-[#0c0f16] px-2 py-3">
            <div className="px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
              Голосовые
            </div>
            <div className="mt-1.5 space-y-0.5 text-[11px]">
              <div className="flex items-center gap-1.5 rounded-md bg-panel3 px-1.5 py-1.5 text-slate-200">
                <Volume2 className="h-3 w-3 text-accent" />
                <span className="truncate">Общий</span>
                <span className="ml-auto rounded bg-white/10 px-1 text-[9px] text-slate-300">3</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-slate-400">
                <Volume2 className="h-3 w-3" />
                <span className="truncate">Рейд</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-slate-400">
                <Volume2 className="h-3 w-3" />
                <span className="truncate">AFK</span>
              </div>
            </div>
            <div className="mt-3 px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
              Текстовые
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[11px] text-slate-400">
              <Hash className="h-3 w-3" />
              <span className="truncate">общий чат</span>
            </div>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-100">Общий</span>
              <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] text-muted">
                3 участника
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <PreviewTile name="Алексей" initial="А" speaking admin />
              <PreviewTile name="Мария" initial="М" broadcasting />
              <PreviewTile name="Игорь" initial="И" muted />
            </div>
            <div className="mt-2.5 flex items-center gap-1 rounded-lg border border-ok/25 bg-ok/[0.06] px-2 py-1.5 text-[10px] text-ok">
              <Radio className="h-3 w-3 shrink-0" />
              <span className="truncate">Эфир: все каналы · приоритет</span>
            </div>
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/20 text-[9px] font-bold text-accent">
                А
              </span>
              <span className="truncate text-[10px] text-slate-200">Алексей</span>
              <ShieldCheck className="h-3 w-3 shrink-0 text-accent" />
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
                <Mic className="h-3 w-3" />
                <Headphones className="h-3 w-3" />
                <SlidersHorizontal className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="max-w-2xl">
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">{eyebrow}</div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{title}</h2>
      {text && <p className="mt-3 text-sm leading-relaxed text-muted">{text}</p>}
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <SiteHeader page="home" />
      <main>
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-48 left-1/2 h-[460px] w-[880px] -translate-x-1/2 rounded-full bg-accent/20 blur-[130px]" />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel2 px-3 py-1 text-[11px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                Голос · текст · демонстрация экрана
              </span>
              <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-slate-50 sm:text-5xl">
                Голосовой сервер{' '}
                <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">
                  для вашей команды
                </span>
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
                LA2Speak — голосовой и текстовый сервер для команды: каналы, демонстрация экрана,
                вещание для администраторов, роли и гостевые приглашения.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-2.5">
                <a
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary h-11 px-5"
                >
                  <Send className="h-4 w-4" />
                  Написать в Telegram
                </a>
                <a href="/guides" className="btn-ghost h-11 px-5">
                  <BookOpen className="h-4 w-4" />
                  Гайд для администраторов
                </a>
              </div>
              <div className="mt-8 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-5 text-xs text-muted">
                <div>
                  <div className="text-base font-semibold text-slate-100">до 150</div>
                  участников на сервер
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-100">Windows · веб · PWA</div>
                  установка на телефон
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-100">Global</div>
                  клавиши и кнопки мыши
                </div>
              </div>
            </div>
            <AppPreview />
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-t border-line/70 bg-panel/30">
          <div className="mx-auto w-full max-w-6xl px-5 py-16">
            <SectionTitle
              eyebrow="Возможности"
              title="Всё для голоса и координации — в одном месте"
              text="Каналы, роли, модерация и вещание настраиваются внутри сервера."
            />
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="card p-5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3.5 text-sm font-semibold text-slate-100">{feature.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">{feature.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

      </main>
      <SiteFooter />
    </div>
  );
}
