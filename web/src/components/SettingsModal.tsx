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
  RefreshCw,
  Shield,
  UserRound,
  Users,
  Volume2,
} from 'lucide-react';
import { MAX_DISPLAY_NAME } from '@tsds/shared';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { useApp } from '../lib/store';
import { updateSettings, toast } from '../lib/actions';
import { api } from '../lib/api';
import {
  HOTKEY_OPTIONS,
  PTT_OPTIONS,
  isGlobalAccelerator,
  micLevelPercent,
  sensitivityThreshold,
} from '../lib/settings';
import { applyMicGate, createMicGateNode, createNoiseFilter } from '../lib/micGate';
import { useCan } from '../lib/roles';
import { desktop } from '../lib/desktop';
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

function HotkeySelect({
  value,
  onChange,
  isUsed,
  warning,
}: {
  value: string;
  onChange: (value: string) => void;
  isUsed: (value: string) => boolean;
  warning: string | null;
}) {
  return (
    <div>
      <div className="relative">
        <select
          className="input appearance-none pr-9"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {HOTKEY_OPTIONS.map((option) => {
            const taken = option.value !== '' && option.value !== value && isUsed(option.value);
            return (
              <option key={option.value || 'none'} value={option.value} disabled={taken}>
                {option.label}
                {taken ? ' — занято' : ''}
              </option>
            );
          })}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>
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
  const [monitor, setMonitor] = useState(false);
  const [testRetry, setTestRetry] = useState(0);
  const [nickname, setNickname] = useState('');
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const testGateRef = useRef<AudioWorkletNode | null>(null);
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

          const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
          const ctx: AudioContext = new Ctx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);

          const gate = await createMicGateNode(ctx);
          if (cancelled) {
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
          testGainRef.current = gain;
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
      testGainRef.current = null;
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
      setTestStream(null);
      setLevel(0);
      setTestError(null);
      setProcessing(null);
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
  const globalHint = desktop
    ? isGlobalAccelerator(settings.pttKey)
      ? 'Сочетание работает глобально, даже когда окно свёрнуто.'
      : 'Одиночная клавиша работает только при активном окне. Выберите сочетание для глобального режима.'
    : 'В браузере push-to-talk работает, когда вкладка активна. В приложении для Windows доступны глобальные сочетания.';

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

  const hotkeyTakenBy = (targetId: string, accelerator: string): boolean => {
    if (!accelerator) return false;
    if (accelerator === settings.pttKey) return true;
    return broadcastTargets.some((target) => target.id !== targetId && target.value === accelerator);
  };

  const hotkeyWarning = (targetId: string, value: string): string | null => {
    if (!value) return null;
    if (value === settings.pttKey) {
      return 'Клавиша занята Push-to-talk — для вещания она не сработает.';
    }
    if (broadcastTargets.some((target) => target.id !== targetId && target.value === value)) {
      return 'Клавиша уже назначена другой цели — сработает только первое назначение.';
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
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    {me.role === 'admin' ? 'администратор' : 'участник'}
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
                  Ник видят все участники. Значок щита рядом с именем показывает, что вы
                  администратор.
                </p>
                {nicknameError && <p className="mt-1 text-[11px] text-danger">{nicknameError}</p>}
              </div>
            </div>
          </Section>
        )}

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
                    onChange={(event) =>
                      updateSettings({ mode: event.target.value === 'ptt' ? 'ptt' : 'open' })
                    }
                  >
                    <option value="open">Открытый микрофон</option>
                    <option value="ptt">Push-to-talk</option>
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
                description="Подавляет фоновый шум вентилятора, клавиатуры и улицы."
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
                      ? 'Push-to-talk: передача по клавише'
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

        <Section icon={Keyboard} title="Push-to-talk">
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
            <p className="text-[11px] leading-relaxed text-muted">{globalHint}</p>
            {settings.mode !== 'ptt' && (
              <p className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] text-warn">
                Сейчас включён открытый микрофон. Выберите режим «Push-to-talk» выше, чтобы
                использовать клавишу.
              </p>
            )}
          </div>
        </Section>

        {canBroadcast && (
          <Section icon={Radio} title="Горячие клавиши вещания">
            <div className="space-y-3">
              <p className="text-[11px] leading-relaxed text-muted">
                Вещание включается и выключается клавишами, кнопок в интерфейсе нет.
                {desktop
                  ? ' В приложении для Windows назначенные клавиши работают глобально — даже когда окно свёрнуто.'
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
                      <HotkeySelect
                        value={target.value}
                        onChange={(value) => setBroadcastKey(target.id, value)}
                        isUsed={(value) => hotkeyTakenBy(target.id, value)}
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
