import * as mediasoup from 'mediasoup';
import {
  hasPermission,
  isChannelVisible,
  type AckResult,
  type ConsumerParams,
  type MediaKind,
  type OnlineUser,
  type ProducerSource,
  type SpeakerInfo,
  type TransportParams,
} from '@tsds/shared';
import type { AppConfig } from './config.js';
import type { SessionService } from './session.js';
import type { Store } from './store.js';
import type { AppServer, AppSocket } from './types.js';

interface ProducerMeta {
  userId: string;
  channelId: string;
  source: ProducerSource;
  kind: MediaKind;
}

interface Peer {
  userId: string;
  sendTransport?: mediasoup.types.WebRtcTransport;
  recvTransport?: mediasoup.types.WebRtcTransport;
  producers: Map<string, mediasoup.types.Producer>;
  consumers: Map<string, mediasoup.types.Consumer>;
  ready: boolean;
  rtpCapabilities?: mediasoup.types.RtpCapabilities;
  closed: boolean;
  syncChain: Promise<void>;
}

function transportParams(transport: mediasoup.types.WebRtcTransport): TransportParams {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

export class VoiceManager {
  private worker!: mediasoup.types.Worker;
  private router!: mediasoup.types.Router;
  private observer!: mediasoup.types.AudioLevelObserver;
  private readonly peers = new Map<string, Peer>();
  private readonly producers = new Map<string, mediasoup.types.Producer>();
  private readonly producerMeta = new Map<string, ProducerMeta>();

  constructor(
    private readonly io: AppServer,
    private readonly config: AppConfig,
    private readonly store: Store,
    private readonly sessions: SessionService,
  ) {}

  async start(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort,
      logLevel: 'warn',
    });
    this.worker.on('died', () => {
      console.error('[voice] mediasoup worker died, exiting in 2s');
      setTimeout(() => process.exit(1), 2000);
    });

    this.router = await this.worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          parameters: { useinbandfec: 1 },
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: { 'x-google-start-bitrate': 1000 },
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
          },
        },
      ],
    });

    this.observer = await this.router.createAudioLevelObserver({
      maxEntries: 8,
      threshold: -60,
      // Индикатор речи должен зажигаться почти сразу, но без лишней нагрузки на воркер.
      interval: 200,
    });

    this.observer.on('volumes', (volumes) => {
      const speakers: SpeakerInfo[] = [];
      for (const { producer, volume } of volumes) {
        const meta = this.producerMeta.get(producer.id);
        if (!meta || meta.source !== 'mic') continue;
        speakers.push({ userId: meta.userId, volume });
      }
      this.io.emit('voice:activeSpeakers', speakers);
    });
    this.observer.on('silence', () => {
      this.io.emit('voice:activeSpeakers', []);
    });

    console.log(`[voice] mediasoup worker ${this.worker.pid} ready, router ${this.router.id}`);
  }

  rtpCapabilities(): unknown {
    return this.router.rtpCapabilities;
  }

  private async createTransport(): Promise<mediasoup.types.WebRtcTransport> {
    const listenInfos: mediasoup.types.TransportListenInfo[] = [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: this.config.announcedIp,
      },
      {
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress: this.config.announcedIp,
      },
    ];

    const transport = await this.router.createWebRtcTransport({
      listenInfos,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1_500_000,
    });

    await transport.setMaxIncomingBitrate(3_000_000).catch(() => undefined);
    return transport;
  }

  private getPeer(userId: string): Peer | undefined {
    return this.peers.get(userId);
  }

  private ensurePeer(userId: string): Peer {
    let peer = this.peers.get(userId);
    if (!peer) {
      peer = {
        userId,
        producers: new Map(),
        consumers: new Map(),
        ready: false,
        closed: false,
        syncChain: Promise.resolve(),
      };
      this.peers.set(userId, peer);
    }
    return peer;
  }

  async join(socket: AppSocket, userId: string, channelId: string): Promise<AckResult> {
    const channel = this.store.channelById(channelId);
    if (!channel || channel.type !== 'voice') {
      return { ok: false, error: 'Голосовой канал не найден' };
    }
    const online = this.sessions.get(userId);
    if (!online) return { ok: false, error: 'Сессия не найдена' };
    if (!isChannelVisible(online, channel)) {
      return { ok: false, error: 'Этот канал недоступен вам' };
    }
    if (
      online.role !== 'admin' &&
      channel.passwordHash &&
      !this.sessions.isChannelUnlocked(userId, channelId)
    ) {
      return { ok: false, error: 'Канал защищён паролем' };
    }

    if (online.channelId && online.channelId !== channelId) {
      await this.leave(userId);
    }

    const existing = this.getPeer(userId);
    if (online.channelId === channelId && existing && !existing.closed && existing.sendTransport) {
      socket.emit('voice:transports', {
        send: transportParams(existing.sendTransport),
        recv: transportParams(existing.recvTransport!),
      });
      return { ok: true };
    }

    if (!existing || existing.closed) {
      if (this.peers.size >= this.config.maxParticipants) {
        return {
          ok: false,
          error: `На сервере достигнут лимит участников (${this.config.maxParticipants})`,
        };
      }
      // Резервируем место до создания транспортов, чтобы параллельные входы не превысили лимит.
      this.ensurePeer(userId);
    }

    this.sessions.update(userId, {
      channelId,
      broadcasting: false,
      broadcastAll: false,
      broadcastGroupIds: [],
      screenSharing: false,
    });

    const peer = this.ensurePeer(userId);
    peer.closed = false;
    peer.ready = false;
    peer.rtpCapabilities = undefined;

    try {
      const sendTransport = await this.createTransport();
      const recvTransport = await this.createTransport();
      peer.sendTransport = sendTransport;
      peer.recvTransport = recvTransport;

      sendTransport.on('@close', () => {
        // peer cleanup happens in leave()
      });

      socket.emit('voice:transports', {
        send: transportParams(sendTransport),
        recv: transportParams(recvTransport),
      });
      return { ok: true };
    } catch (error) {
      console.error('[voice] failed to create transports', error);
      await this.leave(userId);
      return { ok: false, error: 'Не удалось создать WebRTC-транспорт' };
    }
  }

  async connectTransport(
    userId: string,
    direction: 'send' | 'recv',
    dtlsParameters: unknown,
  ): Promise<AckResult> {
    const peer = this.getPeer(userId);
    if (!peer) return { ok: false, error: 'Вы не в голосовом канале' };
    const transport = direction === 'send' ? peer.sendTransport : peer.recvTransport;
    if (!transport) return { ok: false, error: 'Транспорт не найден' };
    try {
      await transport.connect({
        dtlsParameters: dtlsParameters as mediasoup.types.DtlsParameters,
      });
      return { ok: true };
    } catch (error) {
      console.error('[voice] connectTransport failed', error);
      return { ok: false, error: 'Ошибка подключения WebRTC-транспорта' };
    }
  }

  async ready(userId: string, rtpCapabilities: unknown): Promise<AckResult> {
    const peer = this.getPeer(userId);
    if (!peer || peer.closed) return { ok: false, error: 'Вы не в голосовом канале' };
    peer.rtpCapabilities = rtpCapabilities as mediasoup.types.RtpCapabilities;
    peer.ready = true;
    this.scheduleSync(peer);
    return { ok: true };
  }

  async produce(
    userId: string,
    kind: MediaKind,
    rtpParameters: unknown,
    source: ProducerSource,
  ): Promise<{ id?: string; error?: string }> {
    const peer = this.getPeer(userId);
    const online = this.sessions.get(userId);
    if (!peer || !online?.channelId || peer.closed || !peer.sendTransport) {
      return { error: 'Вы не в голосовом канале' };
    }
    if (source === 'screen' && kind !== 'video') {
      return { error: 'Демонстрация экрана должна быть видеопотоком' };
    }
    if (source === 'mic' && kind !== 'audio') {
      return { error: 'Микрофон должен быть аудиопотоком' };
    }

    try {
      // один микрофон и одна демонстрация на пользователя
      for (const [producerId, meta] of this.producerMeta) {
        if (meta.userId === userId && meta.source === source) {
          await this.removeProducer(producerId);
        }
      }

      const producer = await peer.sendTransport.produce({
        kind,
        rtpParameters: rtpParameters as mediasoup.types.RtpParameters,
        appData: { source },
      });

      const meta: ProducerMeta = {
        userId,
        channelId: online.channelId,
        source,
        kind,
      };
      this.producers.set(producer.id, producer);
      this.producerMeta.set(producer.id, meta);
      peer.producers.set(producer.id, producer);

      if (source === 'mic') {
        await this.observer.addProducer({ producerId: producer.id }).catch(() => undefined);
        if (online.serverMuted) await producer.pause().catch(() => undefined);
      } else {
        this.sessions.update(userId, { screenSharing: true });
      }

      producer.on('transportclose', () => {
        this.producers.delete(producer.id);
        this.producerMeta.delete(producer.id);
        peer.producers.delete(producer.id);
        if (source === 'mic') {
          this.observer.removeProducer({ producerId: producer.id }).catch(() => undefined);
        }
        this.reconcileAll();
      });

      this.reconcileAll();
      return { id: producer.id };
    } catch (error) {
      console.error('[voice] produce failed', error);
      return { error: 'Не удалось начать передачу медиа' };
    }
  }

  async closeProducer(userId: string, producerId: string): Promise<void> {
    const meta = this.producerMeta.get(producerId);
    if (!meta || meta.userId !== userId) return;
    await this.removeProducer(producerId);
    this.reconcileAll();
  }

  private async removeProducer(producerId: string): Promise<void> {
    const producer = this.producers.get(producerId);
    const meta = this.producerMeta.get(producerId);
    this.producers.delete(producerId);
    this.producerMeta.delete(producerId);
    if (producer) {
      const peer = this.getPeer(meta?.userId ?? '');
      peer?.producers.delete(producerId);
      try {
        await this.observer.removeProducer({ producerId });
      } catch {
        /* producer may already be closed */
      }
      try {
        producer.close();
      } catch {
        /* already closed */
      }
    }
    if (meta?.source === 'screen') {
      this.sessions.update(meta.userId, { screenSharing: false });
    }
  }

  async setBroadcast(
    userId: string,
    targets: { all: boolean; groupIds: string[] },
  ): Promise<AckResult> {
    const online = this.sessions.get(userId);
    if (!online) return { ok: false, error: 'Сессия не найдена' };
    if (!hasPermission(online, this.store.roles(), 'broadcast')) {
      return { ok: false, error: 'Недостаточно прав для вещания во все каналы' };
    }

    const knownGroups = new Set(this.store.broadcastGroups().map((group) => group.id));
    const groupIds = [...new Set(targets.groupIds)].filter((id) => knownGroups.has(id));
    if (targets.groupIds.length > 0 && groupIds.length === 0) {
      return { ok: false, error: 'Группы слушателей не найдены' };
    }
    const all = Boolean(targets.all);
    const enabled = all || groupIds.length > 0;

    if (enabled) {
      if (!online.channelId) {
        return { ok: false, error: 'Сначала войдите в голосовой канал с микрофоном' };
      }
      const hasMic = [...this.producerMeta.values()].some(
        (meta) => meta.userId === userId && meta.source === 'mic',
      );
      if (!hasMic) {
        return { ok: false, error: 'Микрофон не активен — включите его и попробуйте снова' };
      }
    }

    this.sessions.update(userId, {
      broadcasting: enabled,
      broadcastAll: all,
      broadcastGroupIds: groupIds,
    });
    this.reconcileAll();
    return { ok: true };
  }

  // Пересчитывает аудиторию после изменения состава групп.
  onBroadcastGroupsChanged(): void {
    const knownGroups = new Set(this.store.broadcastGroups().map((group) => group.id));
    let changed = false;
    for (const user of this.sessions.list()) {
      if (!user.broadcastGroupIds.some((id) => !knownGroups.has(id))) continue;
      const groupIds = user.broadcastGroupIds.filter((id) => knownGroups.has(id));
      this.sessions.update(
        user.id,
        {
          broadcastGroupIds: groupIds,
          broadcasting: user.broadcastAll || groupIds.length > 0,
        },
        false,
      );
      changed = true;
    }
    if (changed) this.sessions.broadcastUsers();
    this.reconcileAll();
  }

  // Останавливает вещание у тех, кто потерял право broadcast после смены ролей.
  onPermissionsChanged(): void {
    const roles = this.store.roles();
    let changed = false;
    for (const user of this.sessions.list()) {
      if (!user.broadcasting) continue;
      if (hasPermission(user, roles, 'broadcast')) continue;
      this.sessions.update(
        user.id,
        { broadcasting: false, broadcastAll: false, broadcastGroupIds: [] },
        false,
      );
      changed = true;
    }
    if (changed) this.sessions.broadcastUsers();
    this.reconcileAll();
  }

  async applyServerMute(userId: string, muted: boolean): Promise<void> {
    const online = this.sessions.get(userId);
    if (!online) return;
    this.sessions.update(userId, { serverMuted: muted });
    for (const [producerId, meta] of this.producerMeta) {
      if (meta.userId !== userId || meta.source !== 'mic') continue;
      const producer = this.producers.get(producerId);
      if (!producer) continue;
      try {
        if (muted) await producer.pause();
        else await producer.resume();
      } catch {
        /* producer closed */
      }
    }
  }

  async kick(userId: string, byName: string): Promise<void> {
    const online = this.sessions.get(userId);
    const channel = online?.channelId ? this.store.channelById(online.channelId) : undefined;
    await this.leave(userId);
    this.sessions.getSocket(userId)?.emit('voice:kicked', {
      channelName: channel?.name ?? 'канал',
      byName,
    });
  }

  async leave(userId: string): Promise<void> {
    const peer = this.peers.get(userId);
    const online = this.sessions.get(userId);
    if (online) {
      this.sessions.update(
        userId,
        {
          channelId: null,
          broadcasting: false,
          broadcastAll: false,
          broadcastGroupIds: [],
          screenSharing: false,
        },
        false,
      );
    }
    if (!peer) {
      if (online) this.sessions.broadcastUsers();
      return;
    }

    peer.closed = true;
    this.peers.delete(userId);

    const socket = this.sessions.getSocket(userId);
    for (const [producerId, consumer] of peer.consumers) {
      peer.consumers.delete(producerId);
      try {
        consumer.close();
      } catch {
        /* closed */
      }
      socket?.emit('voice:consumerClosed', { consumerId: consumer.id });
    }

    for (const producerId of [...peer.producers.keys()]) {
      await this.removeProducer(producerId);
    }

    try {
      peer.sendTransport?.close();
      peer.recvTransport?.close();
    } catch {
      /* closed */
    }

    if (online) this.sessions.broadcastUsers();
    this.reconcileAll();
  }

  disconnectUser(userId: string): Promise<void> {
    return this.leave(userId);
  }

  private scheduleSync(peer: Peer): void {
    peer.syncChain = peer.syncChain
      .then(() => this.syncPeer(peer))
      .catch((error) => console.error('[voice] sync failed', error));
  }

  private reconcileAll(): void {
    for (const peer of this.peers.values()) {
      this.scheduleSync(peer);
    }
  }

  private isBroadcastAudience(recipientId: string, speaker: OnlineUser): boolean {
    if (!speaker.broadcasting) return false;
    if (speaker.broadcastAll) return true;
    if (speaker.broadcastGroupIds.length === 0) return false;
    return this.store
      .broadcastGroups()
      .some(
        (group) =>
          speaker.broadcastGroupIds.includes(group.id) && group.memberIds.includes(recipientId),
      );
  }

  private async syncPeer(peer: Peer): Promise<void> {
    if (peer.closed) return;
    const online = this.sessions.get(peer.userId);
    if (!online?.channelId) return;

    const desired = new Set<string>();
    for (const [producerId, meta] of this.producerMeta) {
      if (meta.userId === peer.userId) continue;
      if (meta.channelId === online.channelId) {
        desired.add(producerId);
        continue;
      }
      const speaker = this.sessions.get(meta.userId);
      // вещание администратора слышно во всех каналах или только выбранным группам
      if (
        meta.source === 'mic' &&
        speaker?.broadcasting &&
        this.isBroadcastAudience(peer.userId, speaker)
      ) {
        desired.add(producerId);
      }
    }

    for (const producerId of [...peer.consumers.keys()]) {
      if (!desired.has(producerId)) {
        this.closeConsumer(peer, producerId);
      }
    }

    if (!peer.ready || !peer.rtpCapabilities || !peer.recvTransport) return;

    for (const producerId of desired) {
      if (peer.consumers.has(producerId)) continue;
      const producer = this.producers.get(producerId);
      if (!producer) continue;
      await this.createConsumer(peer, producer);
    }
  }

  private async createConsumer(
    peer: Peer,
    producer: mediasoup.types.Producer,
  ): Promise<void> {
    if (!peer.recvTransport || !peer.rtpCapabilities || peer.closed) return;
    const meta = this.producerMeta.get(producer.id);
    if (!meta) return;
    if (!this.router.canConsume({ producerId: producer.id, rtpCapabilities: peer.rtpCapabilities })) {
      console.warn(`[voice] user ${peer.userId} cannot consume producer ${producer.id}`);
      return;
    }

    try {
      const consumer = await peer.recvTransport.consume({
        producerId: producer.id,
        rtpCapabilities: peer.rtpCapabilities,
        paused: true,
      });
      if (peer.closed) {
        consumer.close();
        return;
      }
      peer.consumers.set(producer.id, consumer);

      const payload: ConsumerParams = {
        consumerId: consumer.id,
        producerId: producer.id,
        userId: meta.userId,
        kind: consumer.kind,
        source: meta.source,
        rtpParameters: consumer.rtpParameters,
        serverMuted: this.sessions.get(meta.userId)?.serverMuted ?? false,
      };
      this.sessions.getSocket(peer.userId)?.emit('voice:newConsumer', payload);
    } catch (error) {
      if (!peer.closed) console.error('[voice] createConsumer failed', error);
    }
  }

  async resumeConsumer(userId: string, consumerId: string): Promise<AckResult> {
    const peer = this.getPeer(userId);
    if (!peer || peer.closed) return { ok: false, error: 'Вы не в голосовом канале' };
    for (const consumer of peer.consumers.values()) {
      if (consumer.id !== consumerId) continue;
      try {
        await consumer.resume();
        return { ok: true };
      } catch (error) {
        console.error('[voice] resumeConsumer failed', error);
        return { ok: false, error: 'Не удалось возобновить приём медиа' };
      }
    }
    return { ok: false, error: 'Потребитель не найден' };
  }

  private closeConsumer(peer: Peer, producerId: string): void {
    const consumer = peer.consumers.get(producerId);
    if (!consumer) return;
    peer.consumers.delete(producerId);
    try {
      consumer.close();
    } catch {
      /* closed */
    }
    this.sessions.getSocket(peer.userId)?.emit('voice:consumerClosed', {
      consumerId: consumer.id,
    });
  }

  getStats(): { peers: number; producers: number } {
    return { peers: this.peers.size, producers: this.producers.size };
  }

  async close(): Promise<void> {
    for (const userId of [...this.peers.keys()]) {
      await this.leave(userId).catch(() => undefined);
    }
    try {
      await this.worker?.close();
    } catch {
      /* already closed */
    }
  }
}
