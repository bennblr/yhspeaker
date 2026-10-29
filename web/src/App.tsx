import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Lock, Menu, Radio, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChannelView } from './components/ChannelView';
import { SettingsModal } from './components/SettingsModal';
import { AdminModal } from './components/AdminModal';
import { ChannelPasswordModal } from './components/ChannelPasswordModal';
import { MobileVoiceBar } from './components/MobileVoiceBar';
import { ScreenViewer } from './components/ScreenViewer';
import { Toasts } from './components/Toasts';
import { DesktopTitleBar } from './components/DesktopTitleBar';
import { api, type PublicServerConfig } from './lib/api';
import { useApp } from './lib/store';
import { connectSocket, getSocket } from './lib/socket';
import { describeDevice } from './lib/device';
import { voice } from './lib/voice';
import { preloadNoiseSuppressor } from './lib/micGate';
import { logout, toast, toggleBroadcastAll, toggleBroadcastGroup } from './lib/actions';
import { desktop } from './lib/desktop';
import { isGlobalAccelerator, matchesPttKey, matchesPttRelease } from './lib/settings';
import { cn, isTypingTarget, serverLabel } from './lib/utils';
import { currentServerUrl, rememberServer } from './lib/servers';
import { hasPermission } from '@tsds/shared';

function Splash({ offline }: { offline: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-bg px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent2 shadow-glow">
        <Radio className="h-8 w-8 text-white" />
      </div>
      {offline ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-200">Нет связи с сервером</p>
            <p className="text-xs text-muted">Проверьте, что сервер запущен и доступен по сети.</p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary h-9 px-4 text-xs"
              onClick={() => getSocket()?.connect()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Подключиться снова
            </button>
            <button className="btn-ghost h-9 px-4 text-xs" onClick={logout}>
              Выйти
            </button>
          </div>
        </>
      ) : (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <p className="text-sm text-muted">Подключаемся к серверу…</p>
        </>
      )}
    </div>
  );
}

function Shell({ serverName, children }: { serverName: string; children: React.ReactNode }) {
  if (!desktop) return <>{children}</>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DesktopTitleBar serverName={serverName} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

export function App() {
  const token = useApp((state) => state.token);
  const tokenRef = useRef(token);
  const me = useApp((state) => state.me);
  const connection = useApp((state) => state.connection);
  const channels = useApp((state) => state.channels);
  const activeChannelId = useApp((state) => state.activeChannelId);
  const unlockedChannels = useApp((state) => state.unlockedChannels);
  const settings = useApp((state) => state.settings);
  const voiceChannelId = useApp((state) => state.voice.channelId);
  const voiceState = useApp((state) => state.voice);
  const appConfig = useApp((state) => state.config);
  const roles = useApp((state) => state.roles);
  const broadcastGroups = useApp((state) => state.broadcastGroups);
  const canManageChannels = hasPermission(me, roles, 'channels');
  const canBroadcast = hasPermission(me, roles, 'broadcast');

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Модель шумоподавления весит ~23 МБ: греем её в простое, чтобы первое
  // подключение к голосовому каналу не ждало загрузку.
  useEffect(() => {
    if (!token || !settings.noiseSuppression) return;
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => void preloadNoiseSuppressor(), {
        timeout: 8000,
      });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => void preloadNoiseSuppressor(), 3000);
    return () => window.clearTimeout(timer);
  }, [token, settings.noiseSuppression]);

  const [serverConfig, setServerConfig] = useState<PublicServerConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalHotkeys, setGlobalHotkeys] = useState(Boolean(desktop));

  const activeChannel = useMemo(() => {
    const current = channels.find((channel) => channel.id === activeChannelId);
    if (current) return current;
    return (
      channels.find(
        (channel) =>
          !channel.passwordProtected ||
          me?.role === 'admin' ||
          unlockedChannels.includes(channel.id),
      ) ?? null
    );
  }, [channels, activeChannelId, me, unlockedChannels]);

  useEffect(() => {
    let cancelled = false;
    setConfigError(false);
    api
      .config()
      .then((config) => {
        if (!cancelled) setServerConfig(config);
      })
      .catch(() => {
        if (!cancelled) setConfigError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [configAttempt]);

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token, describeDevice());
    voice.attach(socket);
    useApp.getState().setConnection('connecting');

    socket.on('connect', () => {
      useApp.getState().setConnection('online');
    });

    socket.on('disconnect', () => {
      useApp.getState().setConnection('offline');
      useApp.getState().clearChannelUnlocks();
      voice.abort();
    });

    socket.on('connect_error', (error) => {
      useApp.getState().setConnection('offline');
      if (error.message === 'UNAUTHORIZED') {
        toast('error', 'Сессия истекла — войдите снова');
        logout();
      }
    });

    socket.on('state:init', (init) => {
      useApp.getState().applyInit(init);
      void voice.initDevice(init.routerRtpCapabilities);
    });

    socket.on('state:me', (next) => {
      useApp.getState().setMe(next);
    });

    socket.on('state:users', (users) => {
      useApp.getState().applyUsers(users);
    });

    socket.on('channels:update', (next) => {
      useApp.getState().applyChannels(next);
    });

    socket.on('groups:update', (groups) => {
      useApp.getState().setBroadcastGroups(groups);
    });

    socket.on('roles:update', (roles) => {
      useApp.getState().setRoles(roles);
    });

    socket.on('config:update', (next: PublicServerConfig) => {
      setServerConfig(next);
    });

    socket.on('chat:message', (message) => {
      useApp.getState().addMessage(message);
    });

    socket.on('chat:deleted', ({ channelId, messageId }) => {
      useApp.getState().removeMessage(channelId, messageId);
    });

    socket.on('voice:transports', (payload) => {
      void voice.onTransports(payload);
    });

    socket.on('voice:newConsumer', (consumer) => {
      void voice.addConsumer(consumer);
    });

    socket.on('voice:consumerClosed', ({ consumerId }) => {
      voice.removeConsumer(consumerId);
    });

    socket.on('voice:activeSpeakers', (speakers) => {
      useApp.getState().setSpeaking(speakers.map((speaker) => speaker.sessionId));
    });

    socket.on('voice:kicked', ({ channelName, byName }) => {
      voice.abort();
      toast('info', `${byName} отключил вас от канала «${channelName}»`);
    });

    socket.on('voice:moved', ({ channelId, channelName, byName }) => {
      toast('info', `${byName} переместил вас в канал «${channelName}»`);
      void voice.join(channelId);
    });

    socket.on('voice:joinFailed', ({ message }) => {
      voice.handleJoinFailed(message);
    });

    socket.on('toast', ({ type, text }) => {
      toast(type, text);
    });

    socket.on('session:ended', ({ reason }) => {
      logout();
      toast('info', reason);
    });

    socket.on('session:token', ({ token: nextToken }) => {
      // Zustand-токен не трогаем: его смена пересоздала бы сокет и голосовую сессию.
      tokenRef.current = nextToken;
      localStorage.setItem('la2speak.token', nextToken);
    });

    return () => {
      socket.disconnect();
      voice.reset();
    };
  }, [token]);

  useEffect(() => {
    if (!token || !activeChannelId || connection !== 'online' || !me || me.isGuest) return;
    let cancelled = false;
    api
      .messages(activeChannelId, tokenRef.current ?? token)
      .then((result) => {
        if (!cancelled) useApp.getState().setMessages(activeChannelId, result.messages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, activeChannelId, connection, me?.isGuest]);

  useEffect(() => {
    if (!me) {
      setSettingsOpen(false);
      setAdminOpen(false);
      setSidebarOpen(false);
    }
  }, [me]);

  useEffect(() => {
    if (settings.mode === 'open' || !voiceChannelId) return;

    const down = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      if (!matchesPttKey(event, settings.pttKey)) return;
      event.preventDefault();
      if (settings.mode === 'toggle') voice.toggleMicByKey();
      else voice.setPtt(true);
    };
    const up = (event: KeyboardEvent) => {
      if (settings.mode !== 'ptt') return;
      if (!matchesPttRelease(event, settings.pttKey)) return;
      voice.setPtt(false);
    };
    const release = () => voice.setPtt(false);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
      voice.setPtt(false);
    };
  }, [settings.mode, settings.pttKey, voiceChannelId]);

  useEffect(() => {
    if (!desktop) return;
    void desktop.setPttKey(settings.pttKey);
    void desktop.setMicMode(settings.mode);
  }, [settings.pttKey, settings.mode]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onPtt((down) => {
      if (useApp.getState().settings.mode !== 'ptt') return;
      if (!useApp.getState().voice.channelId) return;
      voice.setPtt(down);
    });
  }, []);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onMicToggle(() => voice.toggleMicByKey());
  }, []);

  const voiceChannelName = channels.find((item) => item.id === voiceChannelId)?.name ?? '';

  useEffect(() => {
    if (!desktop) return;
    const serverMuted = Boolean(me?.serverMuted);
    const micOn =
      Boolean(voiceChannelId) &&
      voiceState.micReady &&
      !voiceState.muted &&
      !voiceState.deafened &&
      !serverMuted &&
      (settings.mode !== 'ptt' || voiceState.pttActive);
    desktop.setMicState({
      inCall: Boolean(voiceChannelId),
      on: micOn,
      muted: voiceState.muted || voiceState.deafened || serverMuted,
      broadcasting: Boolean(me?.broadcasting),
      channelName: voiceChannelName,
    });
  }, [
    voiceChannelId,
    voiceChannelName,
    voiceState.micReady,
    voiceState.muted,
    voiceState.deafened,
    voiceState.pttActive,
    me?.serverMuted,
    me?.broadcasting,
    settings.mode,
  ]);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    desktop
      .hotkeysAvailable()
      .then((available) => {
        if (!cancelled) setGlobalHotkeys(available);
      })
      .catch(() => {
        if (!cancelled) setGlobalHotkeys(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!desktop) return;
    if (!canBroadcast) {
      void desktop.setBroadcastKeys([]);
      return;
    }
    const bindings: { target: string; accelerator: string }[] = [];
    const used = new Set([settings.pttKey]);
    const add = (target: string, accelerator: string | undefined): void => {
      if (!accelerator || used.has(accelerator) || !isGlobalAccelerator(accelerator)) return;
      used.add(accelerator);
      bindings.push({ target, accelerator });
    };
    add('all', settings.broadcastKeys.all);
    for (const group of broadcastGroups) {
      add(group.id, settings.broadcastKeys.groups[group.id]);
    }
    void desktop.setBroadcastKeys(bindings);
  }, [canBroadcast, settings.broadcastKeys, settings.pttKey, broadcastGroups]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onBroadcastToggle((target) => {
      const state = useApp.getState();
      if (!hasPermission(state.me, state.roles, 'broadcast')) return;
      if (target === 'all') toggleBroadcastAll();
      else toggleBroadcastGroup(target);
    });
  }, []);

  useEffect(() => {
    if (!canBroadcast) return;
    const desktopHotkeys = Boolean(desktop && globalHotkeys);
    const down = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      const state = useApp.getState();
      const keys = state.settings.broadcastKeys;
      if (
        keys.all &&
        keys.all !== state.settings.pttKey &&
        !(desktopHotkeys && isGlobalAccelerator(keys.all)) &&
        matchesPttKey(event, keys.all)
      ) {
        event.preventDefault();
        toggleBroadcastAll();
        return;
      }
      for (const group of state.broadcastGroups) {
        const accelerator = keys.groups[group.id];
        if (!accelerator || accelerator === state.settings.pttKey) continue;
        if (desktopHotkeys && isGlobalAccelerator(accelerator)) continue;
        if (matchesPttKey(event, accelerator)) {
          event.preventDefault();
          toggleBroadcastGroup(group.id);
          return;
        }
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [canBroadcast, globalHotkeys]);

  useEffect(() => {
    const unlock = () => {
      voice.unlockAudio();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const configName = serverConfig?.serverName?.trim() ?? '';
  useEffect(() => {
    if (!serverConfig) return;
    const label = serverLabel(configName);
    const entryName = label !== 'LA2Speak' ? label : '';
    rememberServer(currentServerUrl(), entryName);
    if (desktop) void desktop.setServerName(entryName);
  }, [serverConfig, configName]);

  if (!token) {
    const serverName = serverLabel(serverConfig?.serverName);
    return (
      <Shell serverName={serverName}>
        <div className="h-full">
          <AuthScreen config={serverConfig} />
          {configError && !serverConfig && (
            <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-danger/30 bg-[#111520]/95 px-4 py-2.5 text-xs text-slate-300 shadow-panel">
              <WifiOff className="h-3.5 w-3.5 text-danger" />
              Не удалось получить настройки сервера
              <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setConfigAttempt((n) => n + 1)}>
                Повторить
              </button>
            </div>
          )}
          <Toasts />
        </div>
      </Shell>
    );
  }

  if (!me) {
    const serverName = serverLabel(serverConfig?.serverName);
    return (
      <Shell serverName={serverName}>
        <div className="h-full">
          <Splash offline={connection === 'offline'} />
          <Toasts />
        </div>
      </Shell>
    );
  }

  const serverName = serverLabel(appConfig?.serverName ?? serverConfig?.serverName);

  return (
    <Shell serverName={serverName}>
      <div className="flex h-full min-h-0 overflow-hidden bg-bg">
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-30 cursor-default bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Закрыть меню"
        />
      )}

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 md:static md:z-auto md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
          onNavigate={() => setSidebarOpen(false)}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 md:hidden">
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Открыть каналы"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-100">
              {activeChannel?.name ?? serverName}
            </div>
            <div className="truncate text-[10px] uppercase tracking-wider text-muted">
              {serverName}
            </div>
          </div>
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              connection === 'online'
                ? 'bg-ok'
                : connection === 'connecting'
                  ? 'bg-warn animate-pulse-soft'
                  : 'bg-danger',
            )}
          />
        </header>

        {voiceChannelId && <MobileVoiceBar />}

        {activeChannel ? (
          <ChannelView key={activeChannel.id} channel={activeChannel} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-panel2">
              {channels.length === 0 ? (
                <Radio className="h-7 w-7 text-accent" />
              ) : (
                <Lock className="h-7 w-7 text-accent" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">
                {channels.length === 0
                  ? 'На сервере пока нет каналов'
                  : 'Все каналы защищены паролем'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {channels.length === 0
                  ? canManageChannels
                    ? 'Создайте голосовой или текстовый канал в панели управления.'
                    : 'Администратор скоро создаст первый канал.'
                  : 'Выберите канал в списке слева и введите пароль, чтобы открыть его.'}
              </p>
            </div>
            {canManageChannels && channels.length === 0 && (
              <button
                className="btn-primary h-9 px-4 text-xs"
                onClick={() => setAdminOpen(true)}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Открыть управление
              </button>
            )}
          </div>
        )}
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AdminModal open={adminOpen} onClose={() => setAdminOpen(false)} />
      <ChannelPasswordModal />
      <ScreenViewer />
      <Toasts />
      </div>
    </Shell>
  );
}
