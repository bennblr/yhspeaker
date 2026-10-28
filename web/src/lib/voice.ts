import { Device, type types as MT } from 'mediasoup-client';
import type { ConsumerParams, TransportParams } from '@tsds/shared';
import type { AppSocket } from './socket';
import { useApp } from './store';
import { DEFAULT_SETTINGS, type MicSettings } from './settings';
import { applyMicGate, applyRemoteLevel, createMicGateNode, createNoiseFilter } from './micGate';

interface ConsumerEntry {
  consumer: MT.Consumer;
  userId: string;
  kind: 'audio' | 'video';
  source: 'mic' | 'screen';
}

function patchVoice(patch: Parameters<ReturnType<typeof useApp.getState>['patchVoice']>[0]): void {
  useApp.getState().patchVoice(patch);
}

function toast(type: 'ok' | 'error' | 'info', text: string): void {
  useApp.getState().pushToast(type, text);
}

const AUDIO_JITTER_BUFFER_MS = 120;

// Адаптивный джиттер-буфер Chrome по умолчанию держит 200–500 мс — это и есть
// основная часть задержки при приёме речи. Ограничиваем его разумным минимумом.
function tuneAudioReceiver(consumer: MT.Consumer): void {
  const receiver = consumer.rtpReceiver as unknown as
    | { jitterBufferTarget?: number; playoutDelayHint?: number }
    | undefined;
  if (!receiver) return;
  try {
    if ('jitterBufferTarget' in receiver) {
      receiver.jitterBufferTarget = AUDIO_JITTER_BUFFER_MS;
    } else if ('playoutDelayHint' in receiver) {
      receiver.playoutDelayHint = 0;
    }
  } catch {
    /* браузер не поддерживает настройку */
  }
}

export class VoiceEngine {
  private socket: AppSocket | null = null;
  private device: Device | null = null;
  private deviceLoading: Promise<void> | null = null;
  private sendTransport: MT.Transport | null = null;
  private recvTransport: MT.Transport | null = null;
  private micProducer: MT.Producer | null = null;
  private screenProducer: MT.Producer | null = null;
  private micStream: MediaStream | null = null;
  private rawMic: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private gateNode: AudioWorkletNode | null = null;
  private localScreenStream: MediaStream | null = null;
  private readonly consumers = new Map<string, ConsumerEntry>();
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly screenStreams = new Map<string, MediaStream>();
  private wantMic = false;
  private muted = false;
  private deafened = false;
  private readonly localMuted = new Set<string>();
  private pttActive = false;
  private generation = 0;
  private lastSettings: MicSettings = { ...DEFAULT_SETTINGS };
  private remoteLevelTimer: number | null = null;
  private remoteLevel = 0;
  private visibilityHandler: (() => void) | null = null;
  private readonly lastBytes = new Map<string, number>();

  attach(socket: AppSocket): void {
    this.socket = socket;
  }

  get currentChannelId(): string | null {
    return useApp.getState().voice.channelId;
  }

  private mySettings(): MicSettings {
    return useApp.getState().settings;
  }

  async initDevice(routerRtpCapabilities: unknown): Promise<void> {
    this.deviceLoading = (async () => {
      try {
        const device = new Device();
        await device.load({
          routerRtpCapabilities: routerRtpCapabilities as MT.RtpCapabilities,
        });
        this.device = device;
      } catch (error) {
        console.error('[voice] device load failed', error);
        toast(
          'error',
          'Не удалось инициализировать WebRTC. Проверьте, что сервер настроен корректно.',
        );
      }
    })();
    await this.deviceLoading;
  }

  async join(channelId: string): Promise<void> {
    const socket = this.socket;
    if (!socket) return;
    if (!this.device && this.deviceLoading) await this.deviceLoading;
    if (!this.device) {
      toast('error', 'WebRTC ещё не готов, попробуйте через секунду');
      return;
    }
    if (this.currentChannelId === channelId) return;

    const generation = ++this.generation;
    this.cleanupCall(false);
    patchVoice({
      channelId,
      connecting: true,
      micReady: false,
      pttActive: false,
      localScreen: null,
      remoteScreens: {},
      viewerUserId: null,
    });
    this.wantMic = false;

    try {
      const settings = this.mySettings();
      this.lastSettings = settings;
      this.muted = useApp.getState().voice.muted;
      this.deafened = useApp.getState().voice.deafened;
      const prepared = await this.prepareMic(settings);
      if (generation !== this.generation) return;
      this.wantMic = prepared;
      if (!prepared) {
        toast(
          'info',
          'Микрофон недоступен — вы подключились слушать. Разрешите доступ и нажмите на микрофон.',
        );
      }
    } catch (error) {
      this.wantMic = false;
      if (generation === this.generation) {
        toast('error', this.micErrorMessage(error));
      }
    }

    if (generation !== this.generation) return;

    socket.emit('voice:join', { channelId }, (result) => {
      if (generation !== this.generation) return;
      if (!result.ok) {
        this.cleanupCall(true);
        patchVoice({ channelId: null, connecting: false, micReady: false });
        toast('error', result.error ?? 'Не удалось войти в канал');
      }
    });
  }

  private micErrorMessage(error: unknown): string {
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'Для доступа к микрофону нужен HTTPS (или localhost)';
    }
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Доступ к микрофону запрещён. Разрешите его в браузере';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'Микрофон не найден';
    }
    return 'Не удалось получить доступ к микрофону';
  }

  async onTransports(params: { send: TransportParams; recv: TransportParams }): Promise<void> {
    if (!this.device) return;
    const generation = this.generation;
    this.closeTransports();

    try {
      const sendTransport = this.device.createSendTransport(
        params.send as unknown as MT.TransportOptions,
      );
      const recvTransport = this.device.createRecvTransport(
        params.recv as unknown as MT.TransportOptions,
      );

      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.socket?.emit(
          'voice:connectTransport',
          { direction: 'send', dtlsParameters },
          (result) => {
            if (result.ok) callback();
            else errback(new Error(result.error ?? 'Ошибка подключения транспорта'));
          },
        );
      });

      sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.socket?.emit(
          'voice:produce',
          {
            kind,
            rtpParameters,
            source: (appData?.source as 'mic' | 'screen') ?? 'mic',
          },
          (result) => {
            if (result.id) callback({ id: result.id });
            else errback(new Error(result.error ?? 'Ошибка отправки медиа'));
          },
        );
      });

      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.socket?.emit(
          'voice:connectTransport',
          { direction: 'recv', dtlsParameters },
          (result) => {
            if (result.ok) callback();
            else errback(new Error(result.error ?? 'Ошибка подключения транспорта'));
          },
        );
      });

      sendTransport.on('connectionstatechange', (state) => {
        if (state === 'failed') toast('error', 'Соединение с голосовым сервером потеряно');
      });

      this.sendTransport = sendTransport;
      this.recvTransport = recvTransport;

      let micReady = false;
      if (this.wantMic) {
        micReady = await this.produceMic(generation);
      }
      if (generation !== this.generation) return;

      await new Promise<void>((resolve) => {
        this.socket?.emit(
          'voice:ready',
          { rtpCapabilities: this.device?.rtpCapabilities },
          () => resolve(),
        );
      });
      if (generation !== this.generation) return;

      patchVoice({ connecting: false, micReady });
      this.applyMicGate();
    } catch (error) {
      console.error('[voice] transports setup failed', error);
      if (generation === this.generation) {
        patchVoice({ connecting: false, micReady: false });
        toast('error', 'Не удалось установить голосовое соединение');
      }
    }
  }

  private async prepareMic(settings: MicSettings): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia unavailable');
    }
    this.stopMic();
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId:
          settings.inputDeviceId !== 'default' ? { exact: settings.inputDeviceId } : undefined,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        channelCount: 1,
      },
      video: false,
    });

    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx({ latencyHint: 'interactive' });
    const source = ctx.createMediaStreamSource(raw);
    const gain = ctx.createGain();
    gain.gain.value = settings.inputGain;
    const destination = ctx.createMediaStreamDestination();

    const gate = await createMicGateNode(ctx);

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
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

    this.rawMic = raw;
    this.audioCtx = ctx;
    this.gainNode = gain;
    this.gateNode = gate;
    this.applyGateSettings(settings);
    this.micStream = destination.stream;
    applyRemoteLevel(gate, this.remoteLevel);
    return true;
  }

  private applyGateSettings(settings: MicSettings): void {
    applyMicGate(this.gateNode, settings.micSensitivity, settings.mode !== 'ptt');
  }

  private stopMic(): void {
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.rawMic?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.rawMic = null;
    this.gainNode = null;
    this.gateNode?.disconnect();
    this.gateNode = null;
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
  }

  private async produceMic(generation: number): Promise<boolean> {
    if (!this.sendTransport || !this.micStream) return false;
    try {
      const track = this.micStream.getAudioTracks()[0];
      if (!track) return false;
      const producer = await this.sendTransport.produce({
        track,
        encodings: [{ maxBitrate: 48_000 }],
        codecOptions: {
          opusStereo: false,
          opusDtx: true,
          opusFec: true,
          opusMaxPlaybackRate: 48_000,
        },
        appData: { source: 'mic' },
      });
      if (generation !== this.generation) {
        producer.close();
        return false;
      }
      this.micProducer = producer;
      producer.on('transportclose', () => {
        this.micProducer = null;
        patchVoice({ micReady: false });
      });
      this.applyMicGate();
      return true;
    } catch (error) {
      console.error('[voice] mic produce failed', error);
      this.wantMic = false;
      patchVoice({ micReady: false });
      toast('error', 'Не удалось передать микрофон. Проверьте настройки устройств');
      return false;
    }
  }

  private closeMicProducer(notifyServer: boolean): void {
    if (!this.micProducer) return;
    const id = this.micProducer.id;
    try {
      this.micProducer.close();
    } catch {
      /* already closed */
    }
    this.micProducer = null;
    if (notifyServer) this.socket?.emit('voice:closeProducer', { producerId: id });
    patchVoice({ micReady: false });
  }

  private isMicActive(): boolean {
    const settings = this.mySettings();
    return (
      this.wantMic &&
      Boolean(this.micProducer) &&
      !this.muted &&
      !this.deafened &&
      (settings.mode === 'open' || this.pttActive)
    );
  }

  private applyMicGate(): void {
    const active = this.isMicActive();
    if (this.micProducer) {
      if (active) this.micProducer.resume();
      else this.micProducer.pause();
    }
    if (this.currentChannelId) {
      this.socket?.emit('voice:setMuted', { muted: !active });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    patchVoice({ muted });
    this.applyMicGate();
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    patchVoice({ deafened });
    for (const [id, element] of this.audioElements) {
      const entry = this.consumers.get(id);
      element.muted = deafened || (entry ? this.localMuted.has(entry.userId) : false);
    }
    if (this.currentChannelId) {
      this.socket?.emit('voice:setDeafened', { deafened });
    }
    this.applyMicGate();
  }

  setLocalMuted(userIds: string[]): void {
    this.localMuted.clear();
    for (const id of userIds) this.localMuted.add(id);
    for (const [id, element] of this.audioElements) {
      const entry = this.consumers.get(id);
      if (!entry) continue;
      element.muted = this.deafened || this.localMuted.has(entry.userId);
    }
  }

  setPtt(active: boolean): void {
    if (this.pttActive === active) return;
    this.pttActive = active;
    patchVoice({ pttActive: active });
    this.applyMicGate();
  }

  async enableMic(): Promise<boolean> {
    if (!this.currentChannelId) return false;
    if (this.micProducer) return true;
    try {
      const settings = this.mySettings();
      await this.prepareMic(settings);
      this.wantMic = true;
      if (!this.sendTransport) {
        patchVoice({ micReady: false });
        return false;
      }
      const ok = await this.produceMic(this.generation);
      patchVoice({ micReady: ok });
      if (!ok) this.wantMic = false;
      return ok;
    } catch (error) {
      toast('error', this.micErrorMessage(error));
      return false;
    }
  }

  async applySettings(settings: MicSettings): Promise<void> {
    const previous = this.lastSettings;
    this.lastSettings = settings;
    const micChanged =
      previous.inputDeviceId !== settings.inputDeviceId ||
      previous.echoCancellation !== settings.echoCancellation ||
      previous.noiseSuppression !== settings.noiseSuppression ||
      previous.autoGainControl !== settings.autoGainControl;

    if (this.gainNode) this.gainNode.gain.value = settings.inputGain;
    this.applyGateSettings(settings);
    this.applyOutputVolume(settings);
    void this.applyOutputDevice(settings);

    if (!this.currentChannelId) return;

    if (micChanged && this.wantMic) {
      const generation = this.generation;
      this.closeMicProducer(true);
      this.wantMic = false;
      try {
        const ok = await this.prepareMic(settings);
        if (generation !== this.generation) return;
        this.wantMic = ok;
        if (ok) {
          const produced = await this.produceMic(generation);
          patchVoice({ micReady: produced });
          if (!produced) this.wantMic = false;
        }
      } catch (error) {
        toast('error', this.micErrorMessage(error));
      }
    }

    this.applyMicGate();
  }

  private applyOutputVolume(settings: MicSettings): void {
    for (const element of this.audioElements.values()) {
      element.volume = Math.max(0, Math.min(1, settings.outputVolume));
    }
  }

  private async applyOutputDevice(settings: MicSettings): Promise<void> {
    const sinkId = settings.outputDeviceId === 'default' ? '' : settings.outputDeviceId;
    for (const element of this.audioElements.values()) {
      const withSink = element as HTMLAudioElement & {
        sinkId?: string;
        setSinkId?: (id: string) => Promise<void>;
      };
      if (typeof withSink.setSinkId !== 'function') continue;
      // Не переключаем устройство без необходимости: лишняя смена sink
      // сбивает опорный сигнал эхоподавления Chromium.
      if (withSink.sinkId === sinkId) continue;
      await withSink.setSinkId(sinkId).catch(() => undefined);
    }
  }

  // Уровень входящих голосов нужен гейту: он не должен открываться
  // на остатках эха от динамиков, пока звук идёт от собеседников.
  private startRemoteLevelWatch(): void {
    if (this.remoteLevelTimer !== null) return;
    this.remoteLevelTimer = window.setInterval(() => {
      void this.pollRemoteLevel();
    }, 400);
    this.visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.remoteLevel = 0;
        this.lastBytes.clear();
        applyRemoteLevel(this.gateNode, 0);
        return;
      }
      void this.pollRemoteLevel();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private stopRemoteLevelWatch(): void {
    if (this.remoteLevelTimer !== null) {
      window.clearInterval(this.remoteLevelTimer);
      this.remoteLevelTimer = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.remoteLevel = 0;
    this.lastBytes.clear();
    applyRemoteLevel(this.gateNode, 0);
  }

  private async pollRemoteLevel(): Promise<void> {
    if (document.visibilityState === 'hidden') {
      applyRemoteLevel(this.gateNode, 0);
      return;
    }
    const live = new Set<string>();
    let level = 0;
    for (const [id, entry] of this.consumers) {
      if (entry.kind !== 'audio') continue;
      live.add(id);
      try {
        const report = await entry.consumer.getStats();
        report.forEach((stat) => {
          const audio = stat as unknown as {
            type?: string;
            kind?: string;
            audioLevel?: number;
            bytesReceived?: number;
          };
          if (audio.type !== 'inbound-rtp' || audio.kind !== 'audio') return;
          const bytes = Number(audio.bytesReceived ?? 0);
          const previous = this.lastBytes.get(id);
          this.lastBytes.set(id, bytes);
          if (previous !== undefined && bytes <= previous) return;
          const value = Number(audio.audioLevel);
          if (Number.isFinite(value) && value > level) level = value;
        });
      } catch {
        /* консьюмер уже закрыт */
      }
    }
    for (const id of [...this.lastBytes.keys()]) {
      if (!live.has(id)) this.lastBytes.delete(id);
    }
    this.remoteLevel = level;
    applyRemoteLevel(this.gateNode, level);
  }

  async addConsumer(params: ConsumerParams): Promise<void> {
    if (!this.recvTransport) return;
    if (this.consumers.has(params.consumerId)) return;
    try {
      const consumer = await this.recvTransport.consume({
        id: params.consumerId,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters as MT.RtpParameters,
      });
      if (!this.recvTransport || this.recvTransport.closed) {
        consumer.close();
        return;
      }
      if (params.kind === 'audio') tuneAudioReceiver(consumer);
      this.consumers.set(consumer.id, {
        consumer,
        userId: params.userId,
        kind: params.kind,
        source: params.source,
      });

      if (params.kind === 'audio') {
        const stream = new MediaStream([consumer.track]);
        const element = new Audio();
        element.srcObject = stream;
        element.autoplay = true;
        element.setAttribute('playsinline', '');
        element.volume = Math.max(0, Math.min(1, this.mySettings().outputVolume));
        element.muted = this.deafened || this.localMuted.has(params.userId);
        element.setAttribute('data-yhspeak-audio', params.userId);
        document.body.appendChild(element);
        void element.play().catch(() => undefined);
        this.audioElements.set(consumer.id, element);
        void this.applyOutputDevice(this.mySettings());
        this.startRemoteLevelWatch();
      } else {
        const stream = new MediaStream([consumer.track]);
        this.screenStreams.set(params.userId, stream);
        useApp.getState().setRemoteScreen(params.userId, stream);
      }

      consumer.on('transportclose', () => this.removeConsumer(consumer.id));
      consumer.on('trackended', () => this.removeConsumer(consumer.id));

      consumer.resume();
      this.socket?.emit('voice:resumeConsumer', { consumerId: consumer.id });
    } catch (error) {
      console.error('[voice] consume failed', error);
    }
  }

  removeConsumer(consumerId: string): void {
    const entry = this.consumers.get(consumerId);
    if (!entry) return;
    this.consumers.delete(consumerId);
    try {
      entry.consumer.close();
    } catch {
      /* already closed */
    }
    const element = this.audioElements.get(consumerId);
    if (element) {
      element.pause();
      element.srcObject = null;
      element.remove();
      this.audioElements.delete(consumerId);
    }
    if (entry.kind === 'video') {
      const stream = this.screenStreams.get(entry.userId);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        this.screenStreams.delete(entry.userId);
      }
      useApp.getState().setRemoteScreen(entry.userId, null);
    }
  }

  async startScreenShare(): Promise<void> {
    if (!this.sendTransport || !this.currentChannelId) {
      toast('error', 'Сначала войдите в голосовой канал');
      return;
    }
    if (this.screenProducer) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 24 },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('no video track');

      const producer = await this.sendTransport.produce({
        track,
        encodings: [{ maxBitrate: 1_800_000 }],
        codecOptions: { videoGoogleStartBitrate: 800 },
        appData: { source: 'screen' },
      });
      this.screenProducer = producer;
      this.localScreenStream = stream;
      useApp.getState().setLocalScreen(stream);

      track.onended = () => void this.stopScreenShare();
      producer.on('transportclose', () => {
        this.screenProducer = null;
        useApp.getState().setLocalScreen(null);
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        console.error('[voice] screen share failed', error);
        toast('error', 'Не удалось начать демонстрацию экрана');
      }
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenProducer) {
      this.localScreenStream?.getTracks().forEach((track) => track.stop());
      this.localScreenStream = null;
      useApp.getState().setLocalScreen(null);
      return;
    }
    const producerId = this.screenProducer.id;
    try {
      this.screenProducer.close();
    } catch {
      /* closed */
    }
    this.screenProducer = null;
    this.localScreenStream?.getTracks().forEach((track) => track.stop());
    this.localScreenStream = null;
    useApp.getState().setLocalScreen(null);
    this.socket?.emit('voice:closeProducer', { producerId });
  }

  leave(): void {
    this.generation += 1;
    this.socket?.emit('voice:leave');
    this.cleanupCall(true);
    patchVoice({
      channelId: null,
      connecting: false,
      micReady: false,
      pttActive: false,
    });
  }

  handleJoinFailed(message: string): void {
    this.abort();
    toast('error', message);
  }

  abort(): void {
    this.generation += 1;
    this.cleanupCall(true);
    patchVoice({
      channelId: null,
      connecting: false,
      micReady: false,
      pttActive: false,
    });
  }

  private closeTransports(): void {
    try {
      this.sendTransport?.close();
      this.recvTransport?.close();
    } catch {
      /* closed */
    }
    this.sendTransport = null;
    this.recvTransport = null;
  }

  private cleanupCall(resetScreen: boolean): void {
    this.closeMicProducer(false);
    if (this.screenProducer) {
      try {
        this.screenProducer.close();
      } catch {
        /* closed */
      }
      this.screenProducer = null;
    }
    for (const entry of [...this.consumers.values()]) {
      this.removeConsumer(entry.consumer.id);
    }
    this.consumers.clear();
    this.stopRemoteLevelWatch();
    for (const element of this.audioElements.values()) {
      element.pause();
      element.srcObject = null;
      element.remove();
    }
    this.audioElements.clear();
    for (const stream of this.screenStreams.values()) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.screenStreams.clear();
    this.closeTransports();
    this.stopMic();
    this.localScreenStream?.getTracks().forEach((track) => track.stop());
    this.localScreenStream = null;
    this.wantMic = false;
    this.pttActive = false;
    if (resetScreen) {
      useApp.getState().setLocalScreen(null);
      useApp.setState((state) => ({
        voice: {
          ...state.voice,
          remoteScreens: {},
          viewerUserId: null,
          pttActive: false,
          localScreen: null,
        },
      }));
    }
  }

  reset(): void {
    this.generation += 1;
    this.cleanupCall(true);
    this.device = null;
    this.socket = null;
    patchVoice({
      channelId: null,
      connecting: false,
      micReady: false,
      pttActive: false,
      localScreen: null,
      remoteScreens: {},
      viewerUserId: null,
    });
  }

  unlockAudio(): void {
    for (const element of this.audioElements.values()) {
      void element.play().catch(() => undefined);
    }
  }

}

export const voice = new VoiceEngine();

useApp.subscribe((state, previous) => {
  if (state.localMuted !== previous.localMuted) voice.setLocalMuted(state.localMuted);
});
voice.setLocalMuted(useApp.getState().localMuted);
