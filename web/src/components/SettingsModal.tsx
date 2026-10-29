import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Headphones,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Plus,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  UserRound,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { MAX_DISPLAY_NAME } from '@tsds/shared';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { useApp } from '../lib/store';
import { updateSettings, toast } from '../lib/actions';
import { api } from '../lib/api';
import {
  PTT_OPTIONS,
  acceleratorFromEvent,
  formatAccelerator,
  isGlobalAccelerator,
  micLevelPercent,
  sensitivityThreshold,
} from '../lib/settings';
import {
  applyMicGate,
  createMicAudioContext,
  createMicGateNode,
  createNoiseFilter,
  createNoiseSuppressorNode,
  type NoiseSuppressorNode,
} from '../lib/micGate';
import { useCan } from '../lib/roles';
import { desktop } from '../lib/desktop';
import {
  currentServerUrl,
  forgetServer,
  listKnownServers,
  normalizeServerUrl,
  rememberServer,
  serverHost,
  type KnownServer,
} from '../lib/servers';
import { cn } from '../lib/utils';

function Toggle({
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{title}</div>
        {description && <div className="mt-0.5 text-[11px] leading-relaxed text-muted">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('switch group shrink-0', checked && 'switch-on')}
      >
        <span className={cn('switch-knob', checked && 'switch-knob-on')} />
      </button>
    </div>
  );
}

function DeviceSelect({
  value,
  onChange,
  devices,
  defaultLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  devices: MediaDeviceInfo[];
  defaultLabel: string;
}) {
  return (
    <div className="relative">
      <select className="input appearance-none pr-9" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="default">{defaultLabel}</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Устройство ${index + 1}`}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

function HotkeyRecorder({
  value,
  onChange,
  warning,
}: {
  value: string;
  onChange: (value: string) => void;
  warning: string | null;
}) {
  const [recording, setRecording] = useState(false);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!recording) return;
    const down = (event: KeyboardEvent) => {
      const bare =
        !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
      if (event.key === 'Escape' && bare) {
        event.preventDefault();
        event.stopPropagation();
        setRecording(false);
        setRecordingHint(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (
        event.key === 'Control' ||
        event.key === 'Alt' ||
        event.key === 'Shift' ||
        event.key === 'Meta'
      ) {
        setRecordingHint('Теперь нажмите клавишу — получится сочетание.');
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) {
        setRecordingHint('Эта клавиша не поддерживается. Попробуйте другую.');
        return;
      }
      onChangeRef.current(accelerator);
      setRecording(false);
      setRecordingHint(null);
    };
    const up = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const cancel = () => {
      setRecording(false);
      setRecordingHint(null);
    };
    const outside = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) cancel();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', cancel);
    };
  }, [recording]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            setRecording((current) => !current);
            setRecordingHint(null);
          }}
          className={cn(
            'input flex min-h-[42px] flex-1 items-center justify-between gap-3 text-left',
            recording && 'border-accent/60 text-accent',
          )}
        >
          <span className={cn('truncate', !recording && !value && 'text-muted')}>
            {recording ? 'Нажмите клавишу или сочетание…' : formatAccelerator(value)}
          </span>
          <Keyboard
            className={cn('h-4 w-4 shrink-0', recording ? 'text-accent' : 'text-muted')}
          />
        </button>
        {value && (
          <button
            type="button"
            className="btn-ghost h-[42px] px-2.5"
            title="Очистить"
            onClick={() => {
              setRecording(false);
              setRecordingHint(null);
              onChange('');
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {recording && (
        <p className="mt-1 text-[11px] text-accent">Нажмите нужную клавишу. Esc — отмена.</p>
      )}
      {recordingHint && <p className="mt-1 text-[11px] text-warn">{recordingHint}</p>}
      {warning && <p className="mt-1 text-[11px] text-warn">{warning}</p>}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Mic;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      <div className="rounded-xl border border-line bg-panel/60 p-4">{children}</div>
    </section>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useApp((state) => state.settings);
  const token = useApp((state) => state.token);
  const me = useApp((state) => state.me);
  const broadcastGroups = useApp((state) => state.broadcastGroups);
  const canBroadcast = useCan('broadcast');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [testError, setTestError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<{
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
  } | null>(null);
  const [neuralSuppression, setNeuralSuppression] = useState<boolean | null>(null);
  const [monitor, setMonitor] = useState(false);
  const [testRetry, setTestRetry] = useState(0);
  const [nickname, setNickname] = useState('');
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [serverList, setServerList] = useState<KnownServer[]>([]);
  const [serverInput, setServerInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const testGateRef = useRef<AudioWorkletNode | null>(null);
  const testSuppressorRef = useRef<NoiseSuppressorNode | null>(null);
  const testGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const monitorRef = useRef<HTMLAudioElement>(null);
  const inputDevices = devices.filter((device) => device.kind === 'audioinput');
  const outputDevices = devices.filter((device) => device.kind === 'audiooutput');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId:
                settings.inputDeviceId !== 'default'
                  ? { exact: settings.inputDeviceId }
                  : undefined,
              echoCancellation: settings.echoCancellation,
              noiseSuppression: settings.noiseSuppression,
              autoGainControl: settings.autoGainControl,
              channelCount: 1,
            },
            video: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          testStreamRef.current?.getTracks().forEach((track) => track.stop());
          testStreamRef.current = stream;

          const ctx: AudioContext = createMicAudioContext();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);

          const gate = await createMicGateNode(ctx);
          const suppressor = settings.noiseSuppression
            ? await createNoiseSuppressorNode(ctx)
            : null;
          if (cancelled) {
            suppressor?.destroy();
            stream.getTracks().forEach((track) => track.stop());
            void ctx.close().catch(() => undefined);
            return;
          }

          const gain = ctx.createGain();
          gain.gain.value = settings.inputGain;
          const destination = ctx.createMediaStreamDestination();
          let head: AudioNode = source;
          if (settings.noiseSuppression) {
            const filter = createNoiseFilter(ctx);
            source.connect(filter);
            head = filter;
            if (suppressor) {
              head.connect(suppressor.node);
              head = suppressor.node;
            }
          }
          if (gate) {
            head.connect(gate);
            gate.connect(gain);
          } else {
            head.connect(gain);
          }
          gain.connect(destination);
          applyMicGate(gate, settings.micSensitivity, settings.mode !== 'ptt');

          audioCtxRef.current = ctx;
          testGateRef.current = gate;
          testSuppressorRef.current = suppressor;
          testGainRef.current = gain;
          setNeuralSuppression(settings.noiseSuppression ? Boolean(suppressor) : null);
          if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

          const trackSettings = (stream.getAudioTracks()[0]?.getSettings() ?? {}) as MediaTrackSettings & {
            noiseSuppression?: boolean;
            echoCancellation?: boolean;
          };
          setProcessing({
            noiseSuppression: trackSettings.noiseSuppression,
            echoCancellation: trackSettings.echoCancellation,
          });
          setTestStream(destination.stream);
          setTestError(null);

          const data = new Uint8Array(analyser.fftSize);
          let lastUpdate = 0;
          const tick = (time: number) => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) {
              const value = (data[i] - 128) / 128;
              sum += value * value;
            }
            if (time - lastUpdate > 70) {
              setLevel(Math.sqrt(sum / data.length));
              lastUpdate = time;
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);

          const list = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setDevices(list);
        } catch (error) {
          if (!cancelled) {
            const name = error instanceof DOMException ? error.name : '';
            setTestError(
              name === 'NotAllowedError'
                ? 'Доступ к микрофону запрещён. Разрешите его в браузере.'
                : !navigator.mediaDevices?.getUserMedia
                  ? 'Для теста микрофона нужен HTTPS или localhost.'
                  : 'Не удалось открыть микрофон для теста.',
            );
            try {
              setDevices(await navigator.mediaDevices.enumerateDevices());
            } catch {
              /* ignore */
            }
          }
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      testStreamRef.current?.getTracks().forEach((track) => track.stop());
      testStreamRef.current = null;
      testGateRef.current = null;
      testSuppressorRef.current?.destroy();
      testSuppressorRef.current = null;
      testGainRef.current = null;
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
      setTestStream(null);
      setLevel(0);
      setTestError(null);
      setProcessing(null);
      setNeuralSuppression(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    settings.inputDeviceId,
    settings.echoCancellation,
    settings.noiseSuppression,
    settings.autoGainControl,
    testRetry,
  ]);

  useEffect(() => {
    if (testGainRef.current) testGainRef.current.gain.value = settings.inputGain;
    applyMicGate(testGateRef.current, settings.micSensitivity, settings.mode !== 'ptt');
  }, [settings.inputGain, settings.micSensitivity, settings.mode]);

  useEffect(() => {
    const element = monitorRef.current;
    if (!element) return;
    element.srcObject = monitor ? testStream : null;
    if (monitor && testStream) {
      element.volume = Math.max(0, Math.min(1, settings.outputVolume));
      void element.play().catch(() => undefined);
      const withSink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof withSink.setSinkId === 'function') {
        void withSink
          .setSinkId(settings.outputDeviceId === 'default' ? '' : settings.outputDeviceId)
          .catch(() => undefined);
      }
    }
  }, [monitor, testStream, settings.outputVolume, settings.outputDeviceId]);

  useEffect(() => {
    if (!open) return;
    setNickname(me?.displayName ?? '');
    setNicknameError(null);
    setNicknameBusy(false);
  }, [open, me?.displayName]);

  useEffect(() => {
    if (!open) return;
    setServerList(listKnownServers());
    setServerInput('');
    setServerError(null);
    setSwitchingTo(null);
  }, [open]);

  function refreshServers(): void {
    setServerList(listKnownServers());
  }

  function openServer(url: string): void {
    if (switchingTo) return;
    if (url === currentServerUrl()) {
      setServerError('Вы уже на этом сервере.');
      return;
    }
    setServerError(null);
    rememberServer(url);
    if (desktop) {
      setSwitchingTo(url);
      void desktop
        .switchServer(url)
        .then((result) => {
          setSwitchingTo(null);
          if (!result.ok) setServerError(result.error ?? 'Не удалось переключиться на сервер.');
        })
        .catch(() => {
          setSwitchingTo(null);
          setServerError('Не удалось переключиться на сервер.');
        });
      return;
    }
    window.location.assign(url);
  }

  function addServer(): void {
    const url = normalizeServerUrl(serverInput);
    if (!url) {
      setServerError('Введите адрес, например chat.la2speak.com');
      return;
    }
    rememberServer(url);
    setServerInput('');
    setServerError(null);
    refreshServers();
  }

  function removeServer(url: string): void {
    forgetServer(url);
    refreshServers();
  }

  async function saveNickname(): Promise<void> {
    if (!token || !me || nicknameBusy) return;
    const value = nickname.trim();
    if (value.length < 2) {
      setNicknameError('Ник: минимум 2 символа');
      return;
    }
    if (value === me.displayName) return;
    setNicknameBusy(true);
    try {
      const result = await api.updateProfile(token, value);
      useApp.setState((state) => ({
        me: state.me ? { ...state.me, displayName: result.account.displayName } : null,
        users: state.users.map((user) =>
          user.id === state.me?.id
            ? { ...user, displayName: result.account.displayName }
            : user,
        ),
      }));
      setNicknameError(null);
      toast('ok', 'Ник обновлён');
    } catch (error) {
      setNicknameError(error instanceof Error ? error.message : 'Не удалось изменить ник');
    } finally {
      setNicknameBusy(false);
    }
  }

  const pttOptions = PTT_OPTIONS;
  const keyAction =
    settings.mode === 'ptt'
      ? 'Клавишу нужно удерживать — передача идёт, пока она нажата.'
      : settings.mode === 'toggle'
        ? 'Нажатие включает микрофон, повторное нажатие выключает.'
        : 'Клавиша не используется: микрофон передаёт постоянно.';
  const globalHint = desktop
    ? isGlobalAccelerator(settings.pttKey)
      ? 'Сочетание работает глобально — даже когда окно свёрнуто или активно другое приложение.'
      : 'Одиночная клавиша работает только при активном окне. Выберите сочетание (например Alt + V) или F8, чтобы клавиша работала в свёрнутом приложении.'
    : 'В браузере клавиша работает, когда вкладка активна. В приложении для Windows клавиша работает глобально.';
  const keyHint = `${keyAction} ${globalHint}`;

  const threshold = sensitivityThreshold(settings.micSensitivity);
  const thresholdPercent = Math.min(99, Math.max(1, micLevelPercent(threshold)));
  const levelPercent = micLevelPercent(level);
  const gateOpen = settings.mode === 'ptt' ? true : level >= threshold;

  const broadcastTargets = [
    { id: 'all', name: 'Все каналы', value: settings.broadcastKeys.all },
    ...broadcastGroups.map((group) => ({
      id: group.id,
      name: group.name,
      value: settings.broadcastKeys.groups[group.id] ?? '',
    })),
  ];

  function setBroadcastKey(targetId: string, accelerator: string): void {
    if (targetId === 'all') {
      updateSettings({ broadcastKeys: { ...settings.broadcastKeys, all: accelerator } });
      return;
    }
    const groups = { ...settings.broadcastKeys.groups };
    if (accelerator) groups[targetId] = accelerator;
    else delete groups[targetId];
    updateSettings({ broadcastKeys: { ...settings.broadcastKeys, groups } });
  }

  const hotkeyWarning = (targetId: string, value: string): string | null => {
    if (!value) return null;
    if (value === settings.pttKey) {
      return 'Клавиша занята клавишей микрофона — для вещания она не сработает.';
    }
    if (broadcastTargets.some((target) => target.id !== targetId && target.value === value)) {
      return 'Клавиша уже назначена другой цели — сработает только первое назначение.';
    }
    if (desktop && !isGlobalAccelerator(value)) {
      return 'Одиночная клавиша сработает только при активном окне приложения — так она не мешает вводу текста.';
    }
    return null;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Настройки"
      subtitle="Изменения сохраняются и применяются автоматически"
      width="max-w-2xl"
      footer={
        <div className="flex justify-end">
          <button className="btn-primary px-5" onClick={onClose}>
            Готово
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {me && !me.isGuest && (
          <Section icon={UserRound} title="Профиль">
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
                <Avatar id={me.id} name={me.displayName} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-slate-100">
                      {me.displayName}
                    </span>
                    {me.role === 'admin' && (
                      <Shield className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Администратор" />
                    )}
                    {me.role === 'moderator' && (
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ok" aria-label="Модератор" />
                    )}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    {me.role === 'admin'
                      ? 'администратор'
                      : me.role === 'moderator'
                        ? 'модератор'
                        : me.role === 'guest'
                          ? 'гость'
                          : 'пользователь'}
                  </div>
                </div>
              </div>
              <div>
                <label className="label">Никнейм</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="input flex-1"
                    value={nickname}
                    onChange={(event) => {
                      setNickname(event.target.value);
                      setNicknameError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveNickname();
                    }}
                    placeholder="Ваш ник"
                    maxLength={MAX_DISPLAY_NAME}
                  />
                  <button
                    className="btn-primary h-[42px] px-4"
                    disabled={nicknameBusy || nickname.trim().length < 2 || nickname.trim() === me.displayName}
                    onClick={() => void saveNickname()}
                  >
                    {nicknameBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Сохранить
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Ник видят все участники. Значок рядом с именем показывает вашу базовую роль:
                  администратор, модератор или пользователь.
                </p>
                {nicknameError && <p className="mt-1 text-[11px] text-danger">{nicknameError}</p>}
              </div>
            </div>
          </Section>
        )}

        <Section icon={Server} title="Серверы">
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-muted">
              Все серверы, на которых вы уже были. Вход на каждом сохраняется отдельно — вернувшись,
              вы останетесь авторизованы.
              {desktop
                ? ' В приложении список также доступен в шапке окна кнопкой «Сервер».'
                : ' Этот список хранится в браузере; на другом устройстве войдите на сервер один раз — аккаунт общий.'}
            </p>

            {serverList.length > 0 && (
              <div className="space-y-1.5">
                {serverList.map((server) => (
                  <div
                    key={server.url}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border px-3 py-2',
                      server.current ? 'border-ok/30 bg-ok/5' : 'border-line bg-panel',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        server.current ? 'bg-ok' : 'bg-accent/70',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">
                        {server.name || serverHost(server.url)}
                      </div>
                      {server.name && (
                        <div className="truncate text-[10px] text-muted">
                          {serverHost(server.url)}
                        </div>
                      )}
                    </div>
                    {server.current ? (
                      <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wider text-ok">
                        <Check className="h-3 w-3" />
                        текущий
                      </span>
                    ) : (
                      <>
                        <button
                          className="btn-ghost h-7 shrink-0 px-2.5 text-xs"
                          disabled={Boolean(switchingTo)}
                          onClick={() => openServer(server.url)}
                        >
                          {switchingTo === server.url ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Открыть
                        </button>
                        <button
                          className="icon-btn h-7 w-7 shrink-0 text-muted hover:text-danger"
                          title="Убрать из списка"
                          onClick={() => removeServer(server.url)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input flex-1"
                value={serverInput}
                onChange={(event) => {
                  setServerInput(event.target.value);
                  setServerError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addServer();
                }}
                placeholder="chat.la2speak.com"
                spellCheck={false}
              />
              <button className="btn-ghost h-[42px] shrink-0 px-3" onClick={addServer}>
                <Plus className="h-4 w-4" />
                Добавить
              </button>
            </div>
            {serverError && <p className="text-[11px] text-danger">{serverError}</p>}
          </div>
        </Section>

        <Section icon={Mic} title="Микрофон">
          <div className="space-y-4">
            <div>
              <label className="label">Устройство ввода</label>
              <DeviceSelect
                value={settings.inputDeviceId}
                onChange={(value) => updateSettings({ inputDeviceId: value })}
                devices={inputDevices}
                defaultLabel="Системный микрофон по умолчанию"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Режим передачи</label>
                <div className="relative">
                  <select
                    className="input appearance-none pr-9"
                    value={settings.mode}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateSettings({
                        mode: value === 'ptt' ? 'ptt' : value === 'toggle' ? 'toggle' : 'open',
                      });
                    }}
                  >
                    <option value="open">Открытый микрофон</option>
                    <option value="ptt">Push-to-talk (удерживать)</option>
                    <option value="toggle">По кнопке (вкл/выкл)</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                </div>
              </div>
              <div>
                <label className="label">Усиление микрофона</label>
                <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={settings.inputGain}
                    onChange={(event) => updateSettings({ inputGain: Number(event.target.value) })}
                    className="flex-1"
                  />
                  <span className="w-10 text-right text-xs font-medium text-slate-300">
                    {Math.round(settings.inputGain * 100)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="divide-y divide-line rounded-lg border border-line bg-panel px-3">
              <Toggle
                checked={settings.echoCancellation}
                onChange={(value) => updateSettings({ echoCancellation: value })}
                title="Эхоподавление"
                description="Убирает эхо от колонок. Рекомендуется держать включённым."
              />
              <Toggle
                checked={settings.noiseSuppression}
                onChange={(value) => updateSettings({ noiseSuppression: value })}
                title="Шумоподавление"
                description="Нейросетевая модель (GTCRN) убирает кашель, клавиатуру, вентилятор и улицу."
              />
              <Toggle
                checked={settings.autoGainControl}
                onChange={(value) => updateSettings({ autoGainControl: value })}
                title="Автоматическая громкость"
                description="Выравнивает уровень голоса ближе к микрофону и дальше от него."
              />
            </div>

            <div className="rounded-lg border border-line bg-panel px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
                  </span>
                  Проверка микрофона
                </div>
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  onClick={() => setTestRetry((value) => value + 1)}
                  title="Перезапустить тест"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-panel3">
                <div className="h-full overflow-hidden rounded-full">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-75',
                      gateOpen
                        ? 'bg-gradient-to-r from-ok via-[#7ce3b6] to-accent'
                        : 'bg-muted/60',
                    )}
                    style={{ width: `${levelPercent}%` }}
                  />
                </div>
                <span
                  className="absolute -top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full bg-warn"
                  style={{ left: `${thresholdPercent}%` }}
                  title="Порог чувствительности"
                />
              </div>
              {testError ? (
                <p className="mt-2 text-[11px] text-danger">{testError}</p>
              ) : (
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full',
                      gateOpen ? 'bg-ok' : 'bg-muted',
                    )}
                  />
                  <span className={gateOpen ? 'text-ok' : 'text-muted'}>
                    {settings.mode === 'ptt'
                      ? 'Push-to-talk: передача, пока клавиша зажата'
                      : settings.mode === 'toggle'
                        ? 'По кнопке: клавиша включает и выключает микрофон'
                        : gateOpen
                          ? 'Сигнал проходит'
                          : 'Тише порога — микрофон не передаёт'}
                  </span>
                  <span className="text-muted">· оранжевая риска — порог</span>
                </p>
              )}
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3">
                  <label
                    className="text-[11px] font-medium text-slate-300"
                    htmlFor="mic-sensitivity"
                  >
                    Чувствительность микрофона
                  </label>
                  <span className="text-[11px] font-semibold text-slate-200">
                    {Math.round(settings.micSensitivity)}%
                  </span>
                </div>
                <input
                  id="mic-sensitivity"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.micSensitivity}
                  onChange={(event) =>
                    updateSettings({ micSensitivity: Number(event.target.value) })
                  }
                  className="mt-2 w-full"
                />
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  Правее — микрофон реагирует на более тихий голос. В открытом режиме звук ниже
                  порога не передаётся; в push-to-talk порог не применяется. «Слышать себя» тоже
                  проходит через этот порог.
                </p>
              </div>

              {settings.noiseSuppression && processing && (
                <p
                  className={cn(
                    'mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed',
                    processing.noiseSuppression
                      ? 'border-ok/20 bg-ok/5 text-ok'
                      : 'border-warn/20 bg-warn/5 text-warn',
                  )}
                >
                  {processing.noiseSuppression
                    ? 'Браузер применяет шумоподавление к этому микрофону. «Слышать себя» идёт через него же.'
                    : 'Браузер не применил шумоподавление к этому микрофону: остаются фильтр низких частот и порог чувствительности.'}
                </p>
              )}

              {settings.noiseSuppression && neuralSuppression !== null && (
                <p
                  className={cn(
                    'mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed',
                    neuralSuppression
                      ? 'border-ok/20 bg-ok/5 text-ok'
                      : 'border-warn/20 bg-warn/5 text-warn',
                  )}
                >
                  {neuralSuppression
                    ? 'Нейросетевое шумоподавление активно: кашель и посторонние звуки не передаются.'
                    : 'Нейросетевое шумоподавление недоступно в этом браузере — работают фильтр и порог.'}
                </p>
              )}

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={monitor}
                  onChange={(event) => setMonitor(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#6c7cff]"
                />
                <Headphones className="h-3.5 w-3.5" />
                Слышать себя (используйте наушники)
              </label>
              <audio ref={monitorRef} className="hidden" />
            </div>
          </div>
        </Section>

        <Section icon={Keyboard} title="Клавиша микрофона">
          <div className="space-y-3">
            <div>
              <label className="label">Клавиша</label>
              <div className="relative">
                <select
                  className="input appearance-none pr-9"
                  value={settings.pttKey}
                  onChange={(event) => updateSettings({ pttKey: event.target.value })}
                >
                  {pttOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} — {option.hint}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">{keyHint}</p>
            {desktop && (
              <p className="text-[11px] leading-relaxed text-muted">
                Состояние микрофона видно на иконке в системном трее: серая — не в канале,
                зелёная — передаёт, красная с чертой — выключен. Щелчок по иконке открывает
                приложение, в меню иконки можно переключить микрофон.
              </p>
            )}
            {settings.mode === 'open' && (
              <p className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] text-warn">
                Сейчас включён открытый микрофон. Выберите режим «Push-to-talk» или «По кнопке»
                выше, чтобы управлять микрофоном клавишей.
              </p>
            )}
          </div>
        </Section>

        {canBroadcast && (
          <Section icon={Radio} title="Горячие клавиши вещания">
            <div className="space-y-3">
              <p className="text-[11px] leading-relaxed text-muted">
                Нажмите на поле и назначьте любое сочетание клавиш — например Ctrl + Shift + K,
                F8 или одиночную клавишу.
                {desktop
                  ? ' В приложении для Windows сочетания и служебные одиночные клавиши работают глобально — даже когда окно свёрнуто. Буквы и цифры без модификатора срабатывают только при активном окне, чтобы не мешать вводу текста.'
                  : ' В браузере клавиши работают, когда вкладка активна; глобальный режим доступен в приложении для Windows.'}
              </p>
              <div className="space-y-2.5">
                {broadcastTargets.map((target) => (
                  <div
                    key={target.id}
                    className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2 sm:w-44">
                      {target.id === 'all' ? (
                        <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
                      ) : (
                        <Users className="h-3.5 w-3.5 shrink-0 text-muted" />
                      )}
                      <span className="truncate text-sm text-slate-200">{target.name}</span>
                    </div>
                    <div className="flex-1">
                      <HotkeyRecorder
                        value={target.value}
                        onChange={(value) => setBroadcastKey(target.id, value)}
                        warning={hotkeyWarning(target.id, target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {broadcastGroups.length === 0 && (
                <p className="text-[11px] leading-relaxed text-muted">
                  Группы слушателей создаются в управлении сервером → «Группы».
                </p>
              )}
              <p className="text-[11px] leading-relaxed text-muted">
                Клавиша переключает цель: повторное нажатие выключает её. Клавиша Push-to-talk
                не может быть назначена вещанию.
              </p>
            </div>
          </Section>
        )}

        <Section icon={Volume2} title="Динамики">
          <div className="space-y-4">
            <div>
              <label className="label">Устройство вывода</label>
              <DeviceSelect
                value={settings.outputDeviceId}
                onChange={(value) => updateSettings({ outputDeviceId: value })}
                devices={outputDevices}
                defaultLabel="Системное устройство по умолчанию"
              />
              {outputDevices.length === 0 && (
                <p className="mt-1.5 text-[11px] text-muted">
                  Список устройств появится после разрешения доступа к микрофону.
                </p>
              )}
            </div>
            <div>
              <label className="label">Общая громкость</label>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.outputVolume}
                  onChange={(event) =>
                    updateSettings({ outputVolume: Number(event.target.value) })
                  }
                  className="flex-1"
                />
                <span className="w-10 text-right text-xs font-medium text-slate-300">
                  {Math.round(settings.outputVolume * 100)}%
                </span>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              Выбор устройства вывода поддерживается в Chromium и Electron. Если слышно эхо,
              оставьте «Системное устройство по умолчанию»: браузерное эхоподавление надёжнее
              всего работает с ним.
            </p>
          </div>
        </Section>

        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2 text-[11px] text-muted">
          <MicOff className="h-3.5 w-3.5" />
          Совет: если эхо слышат другие — включите эхоподавление и наденьте наушники.
        </div>
      </div>
    </Modal>
  );
}
