import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Lock, Menu, Radio, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChannelView } from './components/ChannelView';
import { DirectChat } from './components/DirectChat';
import { SettingsModal } from './components/SettingsModal';
import { AdminModal } from './components/AdminModal';
import { ChannelPasswordModal } from './components/ChannelPasswordModal';
import { MobileVoiceBar } from './components/MobileVoiceBar';
import { ScreenViewer } from './components/ScreenViewer';
import { ScreenSharePicker } from './components/ScreenSharePicker';
import { Toasts } from './components/Toasts';
import { CredentialsDialog } from './components/CredentialsDialog';
import { DesktopTitleBar } from './components/DesktopTitleBar';
import { api, type PublicServerConfig } from './lib/api';
import { useApp } from './lib/store';
import { connectSocket, getSocket } from './lib/socket';
import { describeDevice } from './lib/device';
import { voice } from './lib/voice';
import { preloadNoiseSuppressor } from './lib/micGate';
import {
  endBroadcastHold,
  loadDmHistory,
  loadDmParticipants,
  logout,
  openDirectChat,
  refreshDmConversations,
  releaseBroadcastHolds,
  startBroadcastHold,
  toast,
  toggleBroadcastAll,
  toggleBroadcastGroup,
} from './lib/actions';
import { listenPushMessages, pushNotificationTarget, syncPushSubscription } from './lib/push';
import {
  mobile,
  syncFcmToken,
  syncStoredFcmToken,
} from './lib/mobile';
import { desktop, type BroadcastBinding } from './lib/desktop';
import {
  isGlobalAccelerator,
  matchesPointerKey,
  matchesPointerRelease,
  matchesPttKey,
  matchesPttRelease,
  type BroadcastMode,
  type MicSettings,
} from './lib/settings';
import { cn, isTypingTarget, serverLabel } from './lib/utils';
import { currentServerUrl, rememberServer } from './lib/servers';
import { hasPermission, type BroadcastGroup, type OnlineUser } from '@tsds/shared';
import { playSound, unlockSounds } from './lib/sounds';

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

interface BroadcastBindingEntry {
  target: string;
  priority: boolean;
  accelerator: string;
  mode: BroadcastMode;
}

// Клавиши обычного и приоритетного вещания в одном списке: приоритет
// занимает свободные клавиши последним, чтобы не отобрать их у обычного.
function collectBroadcastBindings(
  settings: MicSettings,
  groups: BroadcastGroup[],
): BroadcastBindingEntry[] {
  const bindings: BroadcastBindingEntry[] = [];
  const used = new Set([settings.pttKey]);
  const add = (
    target: string,
    priority: boolean,
    accelerator: string | undefined,
    mode: BroadcastMode,
  ): void => {
    if (!accelerator || used.has(accelerator)) return;
    used.add(accelerator);
    bindings.push({ target, priority, accelerator, mode });
  };
  add('all', false, settings.broadcastKeys.all, settings.broadcastMode);
  for (const group of groups) {
    add(group.id, false, settings.broadcastKeys.groups[group.id], settings.broadcastMode);
  }
  add('all', true, settings.priorityKeys.all, settings.priorityMode);
  for (const group of groups) {
    add(group.id, true, settings.priorityKeys.groups[group.id], settings.priorityMode);
  }
  return bindings;
}

function desktopTarget(binding: BroadcastBindingEntry): string {
  return binding.priority ? `priority:${binding.target}` : binding.target;
}

function parseDesktopTarget(target: string): { target: string; priority: boolean } {
  if (target.startsWith('priority:')) return { target: target.slice(9), priority: true };
  return { target, priority: false };
}

// Переход из уведомления: собеседник может быть уже в списке переписок,
// среди онлайн-участников или только в полном списке аккаунтов сервера.
function openDmByUserId(userId: string): void {
  const state = useApp.getState();
  const known =
    state.users.find((user) => user.id === userId) ??
    state.dmConversations.find((item) => item.peer.id === userId)?.peer;
  if (known) {
    openDirectChat(known);
    return;
  }
  loadDmParticipants((participants) => {
    const candidate = participants.find((user) => user.id === userId);
    if (candidate) openDirectChat(candidate);
  });
}

export function App() {
  const token = useApp((state) => state.token);
  const tokenRef = useRef(token);
  const pendingDmRef = useRef<string | null>(null);
  // Участники канала до обновления списка — чтобы отличить вход и выход.
  const prevUsersRef = useRef<OnlineUser[]>([]);
  const sessionEndedRef = useRef(false);
  const me = useApp((state) => state.me);
  const connection = useApp((state) => state.connection);
  const channels = useApp((state) => state.channels);
  const activeChannelId = useApp((state) => state.activeChannelId);
  const dmPeer = useApp((state) => state.dmPeer);
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
    prevUsersRef.current = [];
    sessionEndedRef.current = false;

    socket.on('connect', () => {
      useApp.getState().setConnection('online');
      void syncPushSubscription(token);
      void syncStoredFcmToken(token);
    });

    socket.on('disconnect', (reason) => {
      useApp.getState().setConnection('offline');
      useApp.getState().clearChannelUnlocks();
      voice.abort();
      // Выход из аккаунта и завершение сессии сервером — не потеря связи.
      if (reason !== 'io client disconnect' && !sessionEndedRef.current) {
        playSound('connectionLost');
      }
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
      refreshDmConversations();
      const peer = useApp.getState().dmPeer;
      if (peer) loadDmHistory(peer.id);
      const pendingDm = pendingDmRef.current;
      if (pendingDm) {
        pendingDmRef.current = null;
        openDmByUserId(pendingDm);
      }
    });

    socket.on('state:me', (next) => {
      useApp.getState().setMe(next);
    });

    socket.on('state:users', (users) => {
      const channelId = useApp.getState().voice.channelId;
      if (channelId) {
        const before = new Set(
          prevUsersRef.current
            .filter((user) => user.channelId === channelId)
            .map((user) => user.sessionId),
        );
        const after = new Set(
          users.filter((user) => user.channelId === channelId).map((user) => user.sessionId),
        );
        if ([...after].some((id) => !before.has(id))) playSound('channelJoin');
        else if ([...before].some((id) => !after.has(id))) playSound('channelLeave');
      }
      prevUsersRef.current = users;
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

    socket.on('dm:message', (message) => {
      useApp.getState().addDmMessage(message);
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
      // Сервер считает уровни глобально; показываем речь только тех, кто
      // находится в нашем голосовом канале. Сырой список нужен оверлею:
      // он показывает и вещающих из другого канала.
      const state = useApp.getState();
      const ids = speakers.map((speaker) => speaker.sessionId);
      state.setSpeakingAll(ids);
      const channelId = state.voice.channelId;
      if (!channelId) {
        state.setSpeaking([]);
        return;
      }
      const inChannel = new Set(
        state.users
          .filter((user) => user.channelId === channelId)
          .map((user) => user.sessionId),
      );
      state.setSpeaking(ids.filter((id) => inChannel.has(id)));
    });

    socket.on('voice:audience', ({ sessions }) => {
      useApp
        .getState()
        .setAudibleBroadcasters(
          Array.isArray(sessions)
            ? sessions.filter((id): id is string => typeof id === 'string')
            : [],
        );
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
      sessionEndedRef.current = true;
      logout();
      toast('info', reason);
    });

    socket.on('session:token', ({ token: nextToken }) => {
      // Zustand-токен не трогаем: его смена пересоздала бы сокет и голосовую сессию.
      tokenRef.current = nextToken;
      const auth = typeof socket.auth === 'object' && socket.auth ? socket.auth : {};
      socket.auth = { ...auth, token: nextToken };
      localStorage.setItem('la2speak.token', nextToken);
    });

    return () => {
      socket.disconnect();
      voice.reset();
    };
  }, [token]);

  // Клик по уведомлению при уже открытом приложении: service worker
  // присылает идентификатор отправителя, показываем с ним переписку.
  useEffect(() => {
    if (!token) return undefined;
    const initial = pushNotificationTarget();
    if (initial) {
      window.history.replaceState(null, '', window.location.pathname);
      pendingDmRef.current = initial;
    }
    return listenPushMessages((message) => {
      if (message.type === 'dm:open') openDmByUserId(message.userId);
    });
  }, [token]);

  // Android-приложение присылает токен FCM после входа и события службы:
  // кнопки в уведомлении голосового канала и переход к переписке.
  useEffect(() => {
    if (!mobile) return undefined;
    return mobile.onEvent((event) => {
      if (event.type === 'mic-toggle') {
        voice.toggleMicByKey();
        return;
      }
      if (event.type === 'voice-leave') {
        voice.leave();
        return;
      }
      if (event.type === 'open-dm') {
        openDmByUserId(event.userId);
        return;
      }
      if (event.type === 'push-token') {
        const current = tokenRef.current;
        if (current) void syncFcmToken(current, event.token);
        return;
      }
      if (event.type === 'resume' || (event.type === 'network' && event.online)) {
        // Android мог выгрузить сокет из памяти, пока экран был заблокирован.
        getSocket()?.connect();
      }
    });
  }, []);

  useEffect(() => {
    if (!mobile || !token) return;
    mobile.ready();
    mobile.requestNotifications();
    void syncStoredFcmToken(token);
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
    if (settings.mode === 'voice' || !voiceChannelId) return;
    // В приложении для Windows клавишу в фоне нажимает глобальный хук, но
    // пока окно активно, удержание обрабатываем сами: нажатие не должно
    // зависеть от хука. Для push-to-talk дублирование безопасно — повторный
    // setPtt с тем же состоянием ничего не меняет, в отличие от переключения.
    // Действие браузера по умолчанию гасим: иначе пробел, назначенный на
    // микрофон, нажмёт кнопку, которая сейчас в фокусе.
    if (desktop && globalHotkeys) {
      const suppress = (event: KeyboardEvent) => {
        if (event.repeat || isTypingTarget(event.target)) return;
        if (matchesPttKey(event, settings.pttKey)) event.preventDefault();
      };
      const holdDown = (event: KeyboardEvent) => {
        if (settings.mode !== 'ptt' || !matchesPttKey(event, settings.pttKey)) return;
        voice.setPtt(true);
      };
      const holdUp = (event: KeyboardEvent) => {
        if (settings.mode !== 'ptt' || !matchesPttRelease(event, settings.pttKey)) return;
        voice.setPtt(false);
      };
      window.addEventListener('keydown', suppress);
      window.addEventListener('keydown', holdDown);
      window.addEventListener('keyup', holdUp);
      return () => {
        window.removeEventListener('keydown', suppress);
        window.removeEventListener('keydown', holdDown);
        window.removeEventListener('keyup', holdUp);
      };
    }

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
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0 || isTypingTarget(event.target)) return;
      if (!matchesPointerKey(event, settings.pttKey)) return;
      event.preventDefault();
      if (settings.mode === 'toggle') voice.toggleMicByKey();
      else voice.setPtt(true);
    };
    const pointerUp = (event: PointerEvent) => {
      if (settings.mode !== 'ptt') return;
      if (!matchesPointerKey(event, settings.pttKey)) return;
      event.preventDefault();
      voice.setPtt(false);
    };
    // Боковые кнопки мыши в браузере по умолчанию листают историю.
    const auxClick = (event: MouseEvent) => {
      if (event.button !== 0 && matchesPointerKey(event, settings.pttKey)) {
        event.preventDefault();
      }
    };
    const release = () => voice.setPtt(false);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('auxclick', auxClick);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('auxclick', auxClick);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
      voice.setPtt(false);
    };
  }, [settings.mode, settings.pttKey, voiceChannelId, globalHotkeys]);

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

  useEffect(() => {
    if (!desktop?.setOverlayState) return;
    // Оверлей канала живёт в отдельном окне поверх всех: ему нужен только
    // состав голосового канала, вещающие на весь сервер и кто говорит.
    const build = () => {
      const state = useApp.getState();
      const channelId = state.voice.channelId;
      if (!channelId) return null;
      const channel = state.channels.find((item) => item.id === channelId);
      const speaking = new Set(state.speakingAll);
      const selfSessionId = state.me?.sessionId ?? '';
      const pttSpeaking = state.settings.mode === 'ptt' && state.voice.pttActive;
      // Слышимые вещатели приходят с сервера: на весь сервер или на наши
      // группы. Состав групп остальным участникам не раскрывается.
      const broadcasters = new Set(state.audibleBroadcasters);
      const participants = state.users
        .filter((user) => user.channelId === channelId || broadcasters.has(user.sessionId))
        .map((user) => ({
          sessionId: user.sessionId,
          name: user.displayName,
          self: user.sessionId === selfSessionId,
          speaking:
            user.sessionId === selfSessionId && pttSpeaking
              ? true
              : speaking.has(user.sessionId),
          muted: user.muted || user.serverMuted,
          deafened: user.deafened,
          broadcasting: user.broadcasting,
          screen: user.screenSharing,
        }))
        .sort(
          (a, b) =>
            Number(b.self) - Number(a.self) ||
            Number(broadcasters.has(b.sessionId)) - Number(broadcasters.has(a.sessionId)) ||
            a.name.localeCompare(b.name, 'ru'),
        );
      return { channelName: channel?.name ?? '', participants };
    };

    const push = () => desktop?.setOverlayState?.(build());
    push();
    const off = useApp.subscribe((state, prev) => {
      if (
        state.users === prev.users &&
        state.speaking === prev.speaking &&
        state.speakingAll === prev.speakingAll &&
        state.audibleBroadcasters === prev.audibleBroadcasters &&
        state.voice === prev.voice &&
        state.channels === prev.channels &&
        state.me === prev.me &&
        state.settings === prev.settings
      ) {
        return;
      }
      push();
    });
    return () => {
      off();
      desktop?.setOverlayState?.(null);
    };
  }, []);

  const voiceChannelName = channels.find((item) => item.id === voiceChannelId)?.name ?? '';

  useEffect(() => {
    const serverMuted = Boolean(me?.serverMuted);
    const micOn =
      Boolean(voiceChannelId) &&
      voiceState.micReady &&
      !voiceState.muted &&
      !voiceState.deafened &&
      !serverMuted &&
      (settings.mode !== 'ptt' || voiceState.pttActive);
    const state = {
      inCall: Boolean(voiceChannelId),
      on: micOn,
      muted: voiceState.muted || voiceState.deafened || serverMuted,
      broadcasting: Boolean(me?.broadcasting),
      channelName: voiceChannelName,
    };
    desktop?.setMicState(state);
    // Android держит микрофон и звук в foreground-службе, пока идёт звонок:
    // экран можно заблокировать, сессия не оборвётся.
    mobile?.setCallState(state);
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
    // Клавиши отдаём хуку только когда он действительно работает: иначе их
    // обрабатывают оконные слушатели, и нажатие не должно сработать дважды.
    if (!canBroadcast || !globalHotkeys) {
      void desktop.setBroadcastKeys([]);
      return;
    }
    const bindings: BroadcastBinding[] = collectBroadcastBindings(settings, broadcastGroups)
      .filter((binding) => isGlobalAccelerator(binding.accelerator))
      .map((binding) => ({
        target: desktopTarget(binding),
        accelerator: binding.accelerator,
        mode: binding.mode,
      }));
    void desktop.setBroadcastKeys(bindings);
  }, [
    canBroadcast,
    globalHotkeys,
    settings.broadcastKeys,
    settings.broadcastMode,
    settings.priorityKeys,
    settings.priorityMode,
    settings.pttKey,
    broadcastGroups,
  ]);

  useEffect(() => {
    releaseBroadcastHolds();
  }, [settings.broadcastMode, settings.priorityMode]);

  useEffect(() => {
    if (!desktop) return;
    const modeFor = (priority: boolean): BroadcastMode => {
      const state = useApp.getState();
      return priority ? state.settings.priorityMode : state.settings.broadcastMode;
    };
    const offToggle = desktop.onBroadcastToggle((raw) => {
      const state = useApp.getState();
      if (!hasPermission(state.me, state.roles, 'broadcast')) return;
      const { target, priority } = parseDesktopTarget(raw);
      if (modeFor(priority) === 'ptt') return;
      if (target === 'all') toggleBroadcastAll(priority);
      else toggleBroadcastGroup(target, priority);
    });
    const offState = desktop.onBroadcastState?.((event) => {
      const state = useApp.getState();
      if (!hasPermission(state.me, state.roles, 'broadcast')) return;
      const { target, priority } = parseDesktopTarget(event.target);
      if (modeFor(priority) !== 'ptt') return;
      if (event.active) startBroadcastHold(target, priority);
      else endBroadcastHold(target, priority);
    });
    return () => {
      offToggle();
      offState?.();
    };
  }, []);

  useEffect(() => {
    if (!canBroadcast) return;
    const desktopHotkeys = Boolean(desktop && globalHotkeys);

    const allBindings = (): BroadcastBindingEntry[] =>
      collectBroadcastBindings(
        useApp.getState().settings,
        useApp.getState().broadcastGroups,
      );

    // Клавиши, которые обрабатывает браузер: глобальные в приложении уже
    // заняты хуком Windows.
    const windowBindings = (): BroadcastBindingEntry[] =>
      allBindings().filter(
        (binding) => !(desktopHotkeys && isGlobalAccelerator(binding.accelerator)),
      );

    const pressedBinding = (
      event: KeyboardEvent | PointerEvent,
    ): BroadcastBindingEntry | null => {
      const isMouse = !(event instanceof KeyboardEvent);
      const matches = (accelerator: string) =>
        isMouse
          ? matchesPointerKey(event as PointerEvent, accelerator)
          : matchesPttKey(event as KeyboardEvent, accelerator);
      return windowBindings().find((binding) => matches(binding.accelerator)) ?? null;
    };

    const activate = (binding: BroadcastBindingEntry) => {
      if (binding.mode === 'ptt') startBroadcastHold(binding.target, binding.priority);
      else if (binding.target === 'all') toggleBroadcastAll(binding.priority);
      else toggleBroadcastGroup(binding.target, binding.priority);
    };

    // Отпускание сверяем только с самой клавишей или кнопкой: модификаторы
    // к этому моменту игрок уже мог отпустить.
    const release = (event: KeyboardEvent | PointerEvent) => {
      const isMouse = !(event instanceof KeyboardEvent);
      const released = (accelerator: string) =>
        isMouse
          ? matchesPointerRelease(event as PointerEvent, accelerator)
          : matchesPttRelease(event as KeyboardEvent, accelerator);
      for (const binding of windowBindings()) {
        if (binding.mode !== 'ptt') continue;
        if (released(binding.accelerator)) {
          endBroadcastHold(binding.target, binding.priority);
        }
      }
    };

    // Клавиши вещания в приложении нажимает глобальный хук. Окну остаётся
    // погасить действие по умолчанию: иначе пробел «нажмёт» кнопку, которая
    // сейчас в фокусе («Остановить», микрофон и т. п.), и вещание тут же
    // выключится.
    const suppressDefault = (event: KeyboardEvent) => {
      if (!desktopHotkeys) return;
      if (event.repeat || isTypingTarget(event.target)) return;
      if (allBindings().some((binding) => matchesPttKey(event, binding.accelerator))) {
        event.preventDefault();
      }
    };

    const down = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      const binding = pressedBinding(event);
      if (!binding) {
        suppressDefault(event);
        return;
      }
      event.preventDefault();
      activate(binding);
    };
    const up = (event: KeyboardEvent) => {
      release(event);
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0 || isTypingTarget(event.target)) return;
      const binding = pressedBinding(event);
      if (!binding) return;
      event.preventDefault();
      activate(binding);
    };
    const pointerUp = (event: PointerEvent) => {
      release(event);
    };
    // Боковые кнопки мыши иначе листают историю браузера.
    const auxClick = (event: MouseEvent) => {
      if (event.button === 0) return;
      if (windowBindings().some((binding) => matchesPointerKey(event, binding.accelerator))) {
        event.preventDefault();
      }
    };
    // В браузере при потере фокуса клавишу отпустить некому — снимаем эфир.
    // В приложении для Windows глобальный хук всегда пришлёт отпускание, а в
    // Android-приложении экран может погаснуть прямо во время вещания.
    const releaseAll = () => releaseBroadcastHolds();
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('auxclick', auxClick);
    if (!desktopHotkeys && !mobile) {
      window.addEventListener('blur', releaseAll);
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('auxclick', auxClick);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      releaseBroadcastHolds();
    };
  }, [canBroadcast, globalHotkeys]);

  useEffect(() => {
    const unlock = () => {
      voice.unlockAudio();
      unlockSounds();
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
              {dmPeer?.displayName ?? activeChannel?.name ?? serverName}
            </div>
            <div className="truncate text-[10px] uppercase tracking-wider text-muted">
              {dmPeer ? 'Личные сообщения' : serverName}
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

        {dmPeer ? (
          <DirectChat key={dmPeer.id} peer={dmPeer} />
        ) : activeChannel ? (
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
      <ScreenSharePicker />
      <Toasts />
      <CredentialsDialog />
      </div>
    </Shell>
  );
}
