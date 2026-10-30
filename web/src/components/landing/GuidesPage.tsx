import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, Check, Info, Send } from 'lucide-react';
import { SiteFooter, SiteHeader, TELEGRAM_HANDLE, TELEGRAM_URL } from './LandingChrome';

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-300">{children}</p>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
          <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-ok" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-3 text-xs leading-relaxed text-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <div>{children}</div>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-panel3 px-1.5 py-0.5 font-mono text-[12px] text-accent2">
      {children}
    </code>
  );
}

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'panel',
    title: 'Панель платформы',
    body: (
      <div className="space-y-3">
        <P>
          Все серверы живут в панели платформы: адрес <Code>/platform</Code> на домене платформы
          (например, <Code>la2speak.com/platform</Code>). Логин и пароль платформы выдаёт владелец
          платформы — это отдельная учётная запись, не связанная с аккаунтами внутри серверов.
        </P>
        <P>На главном экране видно каждый сервер: статус, домены, лимит участников и действия.</P>
        <Bullets
          items={[
            'Запуск, остановка и перезапуск сервера.',
            'Настройки: название, домены и лимит одновременных голосовых участников.',
            'Логин и пароль администратора конкретного сервера — можно открыть повторно.',
            'Статистика онлайна по дням и по участникам.',
            'Ссылка на установщик клиента для Windows.',
          ]}
        />
        <Note>
          Каждый сервер — отдельный процесс со своими данными, JWT-секретом, портами и лимитом.
          Ошибка на одном сервере не затрагивает остальные.
        </Note>
      </div>
    ),
  },
  {
    id: 'create',
    title: 'Создание сервера',
    body: (
      <div className="space-y-3">
        <P>
          Кнопка «Создать сервер» открывает форму. Заполните название, лимит участников, логин и
          пароль администратора сервера.
        </P>
        <Bullets
          items={[
            <>
              <span className="font-medium text-slate-200">Название</span> — отображается в панели и
              участвует в автоматическом домене.
            </>,
            <>
              <span className="font-medium text-slate-200">Домены</span> — можно оставить пустым: если
              платформа настроена на авто-домены, адрес выдастся автоматически. Домен можно добавить
              и позже.
            </>,
            <>
              <span className="font-medium text-slate-200">Участников</span> — лимит одновременных
              голосовых подключений на сервере. Каждому участнику выделяется по два RTC-порта.
            </>,
            <>
              <span className="font-medium text-slate-200">Логин и пароль администратора</span> —
              учётная запись для входа в сам сервер. Пароль можно сгенерировать кнопкой.
            </>,
          ]}
        />
        <Note>
          Логин и пароль показываются один раз после создания. Позже их можно снова открыть в панели:
          пароль хранится зашифрованным.
        </Note>
      </div>
    ),
  },
  {
    id: 'domain',
    title: 'Домен и DNS',
    body: (
      <div className="space-y-3">
        <P>
          Чтобы сервер открывался по своему адресу, домен должен указывать на сервер платформы.
          Создайте A-запись у регистратора домена:
        </P>
        <pre className="overflow-x-auto rounded-lg border border-line bg-panel px-4 py-3 font-mono text-xs text-slate-300">{`Тип   Имя    Значение
A     chat   <IP сервера платформы>`}</pre>
        <P>
          IP подсказан в шапке панели платформы (строка «DNS: A-запись домена → …»). Домен
          добавляется при создании сервера или в разделе «Домены» его настроек.
        </P>
        <Bullets
          items={[
            'Изменения доменов и названия применяются после перезапуска сервера.',
            'Один домен нельзя привязать сразу к двум серверам.',
            'Сервер открывается по HTTPS — отдельный сертификат настраивать не нужно.',
            'Домены платформы занять нельзя: корень отдаёт лендинг, панель живёт на /platform.',
          ]}
        />
      </div>
    ),
  },
  {
    id: 'first-login',
    title: 'Первый вход и клиент',
    body: (
      <div className="space-y-3">
        <P>
          Откройте домен сервера в браузере и войдите логином администратора сервера — тем, который
          задавали при создании. Первый зарегистрированный аккаунт внутри сервера тоже получает роль
          администратора.
        </P>
        <Bullets
          items={[
            'Браузерная версия работает без установки.',
            'Клиент для Windows — глобальные горячие клавиши и кнопки мыши даже в свёрнутом окне и в игре.',
            'Один аккаунт может быть в сети с нескольких устройств.',
          ]}
        />
        <a
          href="/download/windows"
          className="inline-flex items-center gap-2 text-xs font-medium text-accent transition hover:text-slate-100"
        >
          Скачать клиент для Windows
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    ),
  },
  {
    id: 'channels',
    title: 'Каналы',
    body: (
      <div className="space-y-3">
        <P>
          Каналы находятся в разделе «Каналы» внутри «Управления сервером» (иконка щита внизу
          слева). Быстрое создание доступно прямо в списке каналов.
        </P>
        <Bullets
          items={[
            'Голосовые и текстовые каналы; удаление и переименование.',
            'Пароль на голосовой канал: администратор входит без ввода пароля, остальные — после разблокировки.',
            'Видимость для гостей: гостевой канал доступен всем, остальным можно открыть доступ.',
            'Перемещение участников между голосовыми каналами — из «В сети» или меню участника.',
          ]}
        />
      </div>
    ),
  },
  {
    id: 'roles',
    title: 'Роли и права',
    body: (
      <div className="space-y-3">
        <P>У каждого аккаунта есть базовая роль, а поверх неё можно выдавать пользовательские роли.</P>
        <Bullets
          items={[
            <>
              <span className="font-medium text-slate-200">Гость</span> — только каналы, открытые для
              гостей.
            </>,
            <>
              <span className="font-medium text-slate-200">Пользователь</span> — каналы, открытые для
              пользователей.
            </>,
            <>
              <span className="font-medium text-slate-200">Модератор</span> — видит все каналы, может
              перемещать участников и назначать гостю роль Пользователь.
            </>,
            <>
              <span className="font-medium text-slate-200">Администратор</span> — полный доступ,
              включая роли и назначение любых базовых ролей.
            </>,
          ]}
        />
        <P>
          В разделе «Роли» создаются собственные роли с цветом и набором прав: Вещание, Модерация,
          Каналы, Роли, Группы, Приглашения. Выдаются они в карточке участника на вкладках «В сети» и
          «Аккаунты».
        </P>
        <Note>
          Цвет ника берётся у первой пользовательской роли участника, поэтому порядок выдачи имеет
          значение.
        </Note>
      </div>
    ),
  },
  {
    id: 'participants',
    title: 'Участники, гости и приглашения',
    body: (
      <div className="space-y-3">
        <P>Вкладки «В сети» и «Аккаунты» — центр модерации.</P>
        <Bullets
          items={[
            'Отключить микрофон на сервере, выгнать из канала, забанить или разбанить.',
            'Подписать участника: метка рядом с ником до 20 символов, видна всем.',
            'Переместить в другой голосовой канал, назначить базовую роль и пользовательские роли.',
            'Удалить аккаунт навсегда: логин и имя освобождаются для новой регистрации.',
          ]}
        />
        <P>
          Гостевой доступ настраивается на вкладке «Приглашение»: можно разрешить вход по нику или
          требовать код приглашения. Ссылка с кодом имеет вид{' '}
          <Code>/?guest=…</Code>, а перегенерация кода отключает старую ссылку.
        </P>
        <P>
          Кнопка «Сделать пользователем» превращает гостя в постоянный аккаунт и один раз показывает
          логин и пароль.
        </P>
      </div>
    ),
  },
  {
    id: 'voice',
    title: 'Голос, PTT и вещание',
    body: (
      <div className="space-y-3">
        <P>Настройки микрофона и горячих клавиш — в «Настройках» внизу слева.</P>
        <Bullets
          items={[
            'Режимы микрофона: открытый микрофон, push-to-talk (удерживать) и переключатель.',
            'Клавиша микрофона или боковая кнопка мыши; в клиенте Windows работает глобально, в браузере — при активной вкладке.',
            'Вещание: отдельная клавиша на «все каналы», на группу слушателей и приоритетное вещание с режимом удержания.',
            'По умолчанию клавиши вещания не назначены — назначьте свои в настройках.',
            'Громкость каждого участника регулируется отдельно (0–200%) и запоминается на этом устройстве.',
            'Демонстрация экрана — кнопка в голосовом канале, показ идёт выбранной аудитории.',
          ]}
        />
      </div>
    ),
  },
  {
    id: 'stats',
    title: 'Статистика',
    body: (
      <div className="space-y-3">
        <P>
          В панели платформы у каждого сервера есть «Статистика онлайна»: пиковый, средний и
          суммарный онлайн за период, разбивка по дням, участники и время в сети.
        </P>
        <P>
          Внутри сервера статистика открывается в «Управлении сервером» на вкладке «Статистика» —
          удобно, чтобы посмотреть активность за последние дни.
        </P>
      </div>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Если что-то не работает',
    body: (
      <div className="space-y-3">
        <Bullets
          items={[
            'Домен открывает лендинг платформы — A-запись не указывает на сервер или домен не добавлен в панели.',
            'Сервер помечен «Остановлен» — запустите его в панели; после смены домена или лимита нужен перезапуск.',
            'Нет звука — проверьте разрешение на микрофон, режим push-to-talk и серверный мьют участника.',
            '«Достигнут лимит участников» — поднимите лимит в настройках сервера и перезапустите его.',
            'Ссылка приглашения не работает — код перегенерирован; возьмите актуальную ссылку на вкладке «Приглашение».',
          ]}
        />
        <Note>
          Если проблема не решается — напишите в Telegram{' '}
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent transition hover:text-slate-100"
          >
            {TELEGRAM_HANDLE}
          </a>
          . Это единственный канал поддержки.
        </Note>
      </div>
    ),
  },
];

export function GuidesPage() {
  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <SiteHeader page="guides" />
      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel2 px-3 py-1 text-[11px] text-muted">
              <BookOpen className="h-3 w-3 text-accent" />
              Документация платформы
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
              Гайды для администраторов
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              От первого сервера до тонкой настройки ролей, модерации и вещания. Инструкции
              рассчитаны на владельца платформы и администратора сервера.
            </p>
          </div>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-primary h-10 shrink-0 px-4 text-xs"
          >
            <Send className="h-3.5 w-3.5" />
            Вопросы: {TELEGRAM_HANDLE}
          </a>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-0.5 text-xs">
              {SECTIONS.map((section, index) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="flex items-baseline gap-2 rounded-lg px-2.5 py-2 text-muted transition hover:bg-panel3 hover:text-slate-100"
                >
                  <span className="w-4 shrink-0 text-[10px] font-bold text-line">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {section.title}
                </a>
              ))}
            </nav>
          </aside>

          <div className="space-y-4">
            {SECTIONS.map((section, index) => (
              <section key={section.id} id={section.id} className="card scroll-mt-24 p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-[11px] font-bold text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 className="text-lg font-semibold text-slate-100">{section.title}</h2>
                </div>
                <div className="mt-4">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
