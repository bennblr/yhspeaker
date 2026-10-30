import { useEffect, useRef, useState } from 'react';
import {
  HeadphoneOff,
  Loader2,
  LogOut,
  MicOff,
  MonitorUp,
  MoreVertical,
  Radio,
  Shield,
  ShieldCheck,
  UserX,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  hasPermission,
  type BroadcastGroup,
  type Channel,
  type OnlineUser,
} from '@tsds/shared';
import { Avatar } from './Avatar';
import { LabelBadge } from './LabelBadge';
import { UserMenu } from './UserMenu';
import { useApp } from '../lib/store';
import { cn } from '../lib/utils';
import { primaryRole, roleLabel } from '../lib/roles';
import {
  leaveVoice,
  joinVoice,
  openScreenViewer,
  stopBroadcast,
  toggleScreenShare,
} from '../lib/actions';

function VideoPreview({ stream, muted = true }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />;
}

function ParticipantTile({
  user,
  speaking,
  isSelf,
  canModerate,
}: {
  user: OnlineUser;
  speaking: boolean;
  isSelf: boolean;
  canModerate: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const groups = useApp((state) => state.broadcastGroups);
  const roles = useApp((state) => state.roles);
  const localMuted = useApp((state) => state.localMuted.includes(user.id));
  const volume = useApp((state) => state.userVolumes[user.id] ?? 1);
  const toggleLocalMute = useApp((state) => state.toggleLocalMute);
  const primary = user.role === 'member' ? primaryRole(user, roles) : null;

  return (
    <div
      className={cn(
        'relative flex min-h-[156px] flex-col items-center justify-center gap-3 rounded-2xl border bg-panel2/80 p-4 transition',
        speaking ? 'border-ok/40 bg-ok/[0.05]' : 'border-line hover:border-line/80',
      )}
    >
      <div className="absolute left-2 top-2 flex items-center gap-1">
        {user.broadcasting && (
          <span
            className="flex items-center gap-1 rounded-full bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ok"
            title={`Эфир: ${broadcastAudience(user, groups)}`}
          >
            <Radio className="h-2.5 w-2.5" /> эфир
            {user.broadcastPriority && (
              <span className="rounded-full bg-ok px-1 text-[8px] font-bold text-bg">
                приоритет
              </span>
            )}
          </span>
        )}
      </div>
      {!isSelf && (
        <div className="absolute right-1.5 top-1.5">
          <button
            ref={menuButtonRef}
            className="icon-btn h-7 w-7 opacity-60 hover:opacity-100"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Действия"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <UserMenu
              user={user}
              anchor={menuButtonRef.current}
              canModerate={canModerate}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      )}

      <Avatar id={user.id} name={user.displayName} size="lg" speaking={speaking} />

      <div className="w-full text-center">
        <div className="flex items-center justify-center gap-1.5">
          <span
            className={cn(
              'max-w-full truncate text-sm font-semibold text-slate-100',
              localMuted && 'opacity-50',
            )}
            style={primary ? { color: primary.color } : undefined}
          >
            {user.displayName}
          </span>
          <LabelBadge label={user.label} />
          {user.role === 'admin' && (
            <span title="Администратор" className="shrink-0">
              <Shield className="h-3.5 w-3.5 text-accent" />
            </span>
          )}
          {user.role === 'moderator' && (
            <span title="Модератор" className="shrink-0">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" />
            </span>
          )}
          {isSelf && (
            <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-medium text-slate-300">
              вы
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          {primary && (
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: primary.color }}
            />
          )}
          {roleLabel(user, roles)}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-muted">
        {user.serverMuted && (
          <span title="Микрофон отключён администратором">
            <MicOff className="h-3.5 w-3.5 text-danger" />
          </span>
        )}
        {!user.serverMuted && user.muted && (
          <span title="Микрофон выключен">
            <MicOff className="h-3.5 w-3.5" />
          </span>
        )}
        {user.deafened && (
          <span title="Звук выключен">
            <HeadphoneOff className="h-3.5 w-3.5 text-danger/80" />
          </span>
        )}
        {user.screenSharing && (
          <span title="Демонстрирует экран">
            <MonitorUp className="h-3.5 w-3.5 text-accent" />
          </span>
        )}
        {speaking && <span className="text-[10px] font-medium text-ok">говорит</span>}
        {!isSelf && (
          <>
            {volume !== 1 && (
              <span
                className="rounded bg-accent/10 px-1 text-[10px] font-semibold text-accent"
                title="Ваша громкость этого участника"
              >
                {Math.round(volume * 100)}%
              </span>
            )}
            <button
              type="button"
              className={cn(
                'ml-1 rounded p-0.5 transition hover:bg-white/[0.06]',
                localMuted && 'text-danger',
              )}
              title={localMuted ? 'Включить звук участника у себя' : 'Заглушить участника у себя'}
              onClick={() => toggleLocalMute(user.id)}
            >
              {localMuted ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function broadcastAudience(user: OnlineUser, groups: BroadcastGroup[]): string {
  const audience = (() => {
    if (user.broadcastAll) return 'все голосовые каналы';
    const names = groups
      .filter((group) => user.broadcastGroupIds.includes(group.id))
      .map((group) => `«${group.name}»`);
    if (names.length === 0) return 'без слушателей';
    return names.length === 1 ? `группа ${names[0]}` : `группы ${names.join(', ')}`;
  })();
  return user.broadcastPriority ? `${audience} · приоритет` : audience;
}

export function BroadcastBanner() {
  const users = useApp((state) => state.users);
  const me = useApp((state) => state.me);
  const groups = useApp((state) => state.broadcastGroups);
  const broadcasters = users.filter((user) => user.broadcasting);

  if (broadcasters.length === 0) return null;
  const self = broadcasters.find((user) => user.id === me?.id);
  const others = broadcasters.filter((user) => user.id !== me?.id);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ok/20 bg-gradient-to-r from-ok/[0.09] via-ok/[0.05] to-transparent px-5 py-2.5">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
      </span>
      <Radio className="h-4 w-4 shrink-0 text-ok" />
      <div className="min-w-0 flex-1 text-xs text-slate-300">
        {self && (
          <span className="font-semibold text-ok">
            Вы вещаете: {broadcastAudience(self, groups)}
          </span>
        )}
        {self && others.length > 0 && <span className="mx-1.5 text-muted">·</span>}
        {others.length > 0 && (
          <span>
            <span className="font-semibold text-ok">
              {others.map((user) => user.displayName).join(', ')}
            </span>{' '}
            {others.length === 1 ? 'вещает' : 'вещают'}:{' '}
            {others.map((user) => broadcastAudience(user, groups)).join('; ')}
          </span>
        )}
      </div>
      {self && (
        <button className="btn-ghost h-7 px-2.5 text-xs" onClick={stopBroadcast}>
          Остановить
        </button>
      )}
    </div>
  );
}

export function VoiceStage({ channel }: { channel: Channel }) {
  const users = useApp((state) => state.users);
  const me = useApp((state) => state.me);
  const speaking = useApp((state) => state.speaking);
  const voice = useApp((state) => state.voice);
  const screens = useApp((state) => state.voice.remoteScreens);
  const roles = useApp((state) => state.roles);

  const canModerate = hasPermission(me, roles, 'moderate');
  const canBroadcast = hasPermission(me, roles, 'broadcast');
  const channelUsers = users.filter((user) => user.channelId === channel.id);
  const connected = voice.channelId === channel.id;
  const connecting = voice.connecting && voice.channelId === channel.id;
  const speakingSet = new Set(speaking);
  const localScreen = voice.localScreen;

  const screenCards = [
    ...(localScreen
      ? [
          {
            sessionId: me?.sessionId ?? 'self',
            name: 'Ваш экран',
            stream: localScreen,
            local: true,
          },
        ]
      : []),
    ...Object.entries(screens).map(([sessionId, stream]) => ({
      sessionId,
      name: users.find((user) => user.sessionId === sessionId)?.displayName ?? 'Участник',
      stream,
      local: false,
    })),
  ];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      {screenCards.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            <MonitorUp className="h-3.5 w-3.5" />
            Демонстрация экрана
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {screenCards.map((card) => (
              <div
                key={card.sessionId}
                className="group relative w-[300px] shrink-0 overflow-hidden rounded-xl border border-line bg-black/50"
              >
                <div className="aspect-video">
                  <VideoPreview stream={card.stream} />
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-6">
                  <span className="truncate text-xs font-medium text-slate-200">{card.name}</span>
                  {card.local ? (
                    <button
                      className="rounded-md bg-black/50 px-2 py-1 text-[10px] text-slate-200 hover:bg-black/70"
                      onClick={toggleScreenShare}
                    >
                      Остановить
                    </button>
                  ) : (
                    <button
                      className="rounded-md bg-accent/90 px-2 py-1 text-[10px] font-medium text-white hover:bg-accent"
                      onClick={() => openScreenViewer(card.sessionId)}
                    >
                      Смотреть
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!connected ? (
        <div className="relative flex min-h-[360px] flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-[#121623] via-panel2 to-[#0e111a] px-6 py-10 text-center">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/15 blur-[80px]" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-line bg-panel3 shadow-glow">
            <Volume2 className="h-9 w-9 text-accent" />
          </div>
          <div className="relative">
            <h2 className="text-xl font-bold text-white">{channel.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {channelUsers.length === 0
                ? 'В канале пока никого нет'
                : `Сейчас в канале: ${channelUsers.length}`}
            </p>
          </div>
          {channelUsers.length > 0 && (
            <div className="relative flex flex-wrap justify-center gap-2">
              {channelUsers.map((user) => (
                <div
                  key={user.sessionId}
                  className="flex items-center gap-2 rounded-full border border-line bg-panel/80 py-1 pl-1 pr-3"
                >
                  <Avatar id={user.id} name={user.displayName} size="xs" />
                  <span className="text-xs text-slate-300">{user.displayName}</span>
                </div>
              ))}
            </div>
          )}
          <button
            className="btn-primary relative h-11 px-6"
            onClick={() => void joinVoice(channel.id)}
          >
            <Volume2 className="h-4 w-4" />
            Присоединиться к каналу
          </button>
          <p className="relative max-w-sm text-[11px] leading-relaxed text-muted">
            При первом подключении браузер попросит доступ к микрофону. Вы сможете войти и без
            него — в режиме слушателя.
          </p>
        </div>
      ) : connecting ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-panel2">
          <Loader2 className="h-7 w-7 animate-spin text-accent" />
          <p className="text-sm text-slate-300">Подключаемся к каналу…</p>
          <p className="text-[11px] text-muted">Создаём WebRTC-соединение</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-ok/25 bg-ok/[0.07] px-3 py-1.5 text-xs font-medium text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              Подключено к «{channel.name}»
            </div>
            <button className="btn-ghost h-8 px-3 text-xs" onClick={toggleScreenShare}>
              <MonitorUp className="h-3.5 w-3.5" />
              {voice.localScreen ? 'Остановить показ' : 'Показать экран'}
            </button>
            {canBroadcast && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Radio className="h-3.5 w-3.5" />
                вещание включается клавишами из настроек
              </span>
            )}
            <button className="btn-ghost ml-auto h-8 px-3 text-xs" onClick={leaveVoice}>
              <LogOut className="h-3.5 w-3.5" />
              Отключиться
            </button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {channelUsers.map((user) => (
              <ParticipantTile
                key={user.sessionId}
                user={user}
                speaking={speakingSet.has(user.sessionId)}
                isSelf={user.sessionId === me?.sessionId}
                canModerate={canModerate}
              />
            ))}
            {channelUsers.length === 0 && (
              <div className="col-span-full flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-muted">
                <UserX className="h-6 w-6" />
                <p className="text-xs">Вы одни в канале</p>
              </div>
            )}
          </div>
        </div>
      )}

      {connected && (
        <p className="flex items-center gap-1.5 text-[10px] text-muted">
          <X className="h-3 w-3" />
          Выход из канала доступен кнопкой «Отключиться» — вы останетесь на сервере и в чате.
        </p>
      )}
    </div>
  );
}
