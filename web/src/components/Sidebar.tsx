import { createContext, useContext, useMemo, useState, type DragEvent } from 'react';
import {
  Hash,
  HeadphoneOff,
  Lock,
  MicOff,
  MonitorUp,
  Plus,
  Radio,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { hasPermission, type Channel, type OnlineUser } from '@tsds/shared';
import { Avatar } from './Avatar';
import { DeviceBadge } from './DeviceBadge';
import { LabelBadge } from './LabelBadge';
import { UserBar } from './UserBar';
import { VolumeMenu } from './VolumeMenu';
import { useApp } from '../lib/store';
import { cn, serverLabel } from '../lib/utils';
import { canDragUser, joinVoice, moveUserToChannel, selectChannel } from '../lib/actions';
import { primaryRole, roleLabel } from '../lib/roles';

interface DragState {
  user: OnlineUser | null;
  overChannelId: string | null;
  start: (event: DragEvent, user: OnlineUser) => void;
  end: () => void;
  setOver: (channelId: string | null) => void;
}

const DragContext = createContext<DragState | null>(null);

function ParticipantRow({ user, speaking }: { user: OnlineUser; speaking: boolean }) {
  const me = useApp((state) => state.me);
  const roles = useApp((state) => state.roles);
  const localMuted = useApp((state) => state.localMuted.includes(user.id));
  const volume = useApp((state) => state.userVolumes[user.id] ?? 1);
  const primary = user.role === 'member' ? primaryRole(user, roles) : null;
  const drag = useContext(DragContext);
  const draggable = drag !== null && canDragUser(user);
  const dragging = drag?.user?.sessionId === user.sessionId;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const isSelf = me?.id === user.id;

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (event) => drag.start(event, user) : undefined}
      onDragEnd={draggable ? drag.end : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md py-1 pl-[30px] pr-2 text-[12px] text-slate-400 transition hover:bg-white/[0.03]',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
      title={`${user.displayName}${user.label ? ` (${user.label})` : ''} · ${roleLabel(user, roles)}${user.broadcasting ? ' — вещает' : ''}${draggable ? ' · перетащите в другой канал' : ''}`}
    >
      <Avatar id={user.id} name={user.displayName} size="xs" speaking={speaking} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          speaking && 'text-ok',
          localMuted && 'line-through opacity-60',
        )}
        style={!speaking && primary ? { color: primary.color } : undefined}
      >
        {user.displayName}
      </span>
      {!isSelf && (
        <button
          type="button"
          className={cn(
            'shrink-0 rounded p-0.5 text-muted opacity-60 transition hover:bg-white/[0.06] hover:text-slate-200 hover:opacity-100',
            volume !== 1 && 'text-accent opacity-100',
          )}
          title={`Громкость и заглушение (${Math.round(volume * 100)}%)`}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          <SlidersHorizontal className="h-3 w-3" />
        </button>
      )}
      <DeviceBadge device={user.device} deviceName={user.deviceName} />
      <LabelBadge label={user.label} />
      {user.role === 'admin' && (
        <span title="Администратор" className="shrink-0">
          <Shield className="h-3 w-3 text-accent" />
        </span>
      )}
      {user.role === 'moderator' && (
        <span title="Модератор" className="shrink-0">
          <ShieldCheck className="h-3 w-3 text-ok" />
        </span>
      )}
      {primary && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: primary.color }}
        />
      )}
      <span className="flex items-center gap-1">
        {volume !== 1 && (
          <span
            className="text-[9px] font-semibold text-accent"
            title={`Ваша громкость: ${Math.round(volume * 100)}%`}
          >
            {Math.round(volume * 100)}%
          </span>
        )}
        {localMuted && (
          <span title="Вы заглушили этого участника">
            <VolumeX className="h-3 w-3 text-danger/80" />
          </span>
        )}
        {user.broadcasting && <Radio className="h-3 w-3 text-ok" />}
        {user.screenSharing && <MonitorUp className="h-3 w-3 text-accent" />}
        {user.deafened && <HeadphoneOff className="h-3 w-3 text-danger/80" />}
        {(user.muted || user.serverMuted) && (
          <MicOff className={cn('h-3 w-3', user.serverMuted ? 'text-danger' : 'text-muted')} />
        )}
      </span>
      {menuAnchor && (
        <VolumeMenu user={user} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />
      )}
    </div>
  );
}

function CompactParticipants({ users, speaking }: { users: OnlineUser[]; speaking: Set<string> }) {
  const me = useApp((state) => state.me);
  const roles = useApp((state) => state.roles);
  const localMutedIds = useApp((state) => state.localMuted);
  const userVolumes = useApp((state) => state.userVolumes);
  const drag = useContext(DragContext);
  const [menu, setMenu] = useState<{ user: OnlineUser; anchor: HTMLElement } | null>(null);

  return (
    <div className="flex flex-wrap gap-1 px-2 pb-1.5 pt-0.5">
      {users.map((user) => {
        const primary = user.role === 'member' ? primaryRole(user, roles) : null;
        const isSpeaking = speaking.has(user.sessionId);
        const localMuted = localMutedIds.includes(user.id);
        const volume = userVolumes[user.id] ?? 1;
        const draggable = drag !== null && canDragUser(user);
        const dragging = drag?.user?.sessionId === user.sessionId;
        return (
          <span
            key={user.sessionId}
            draggable={draggable}
            onDragStart={draggable ? (event) => drag.start(event, user) : undefined}
            onDragEnd={draggable ? drag.end : undefined}
            title={`${user.displayName}${user.label ? ` (${user.label})` : ''} · ${roleLabel(user, roles)}${user.broadcasting ? ' — вещает' : ''}`}
            className={cn(
              'flex min-w-0 max-w-full items-center gap-1 rounded-md bg-panel2/70 py-0.5 pl-0.5 pr-1.5 text-[11px] text-slate-300',
              draggable && 'cursor-grab active:cursor-grabbing',
              dragging && 'opacity-40',
            )}
          >
            <Avatar id={user.id} name={user.displayName} size="xs" speaking={isSpeaking} />
            <span
              className={cn(
                'max-w-[120px] truncate',
                isSpeaking && 'text-ok',
                localMuted && 'line-through opacity-60',
              )}
              style={!isSpeaking && primary ? { color: primary.color } : undefined}
            >
              {user.displayName}
            </span>
            {me?.id !== user.id && (
              <button
                type="button"
                className={cn(
                  'shrink-0 rounded p-0.5 text-muted transition hover:bg-white/[0.06] hover:text-slate-200',
                  volume !== 1 && 'text-accent',
                )}
                title={`Громкость и заглушение (${Math.round(volume * 100)}%)`}
                onClick={(event) => setMenu({ user, anchor: event.currentTarget })}
              >
                <SlidersHorizontal className="h-3 w-3" />
              </button>
            )}
            <LabelBadge label={user.label} />
            <DeviceBadge device={user.device} deviceName={user.deviceName} compact />
            {volume !== 1 && (
              <span
                className="shrink-0 text-[9px] font-semibold text-accent"
                title={`Ваша громкость: ${Math.round(volume * 100)}%`}
              >
                {Math.round(volume * 100)}%
              </span>
            )}
            {localMuted && <VolumeX className="h-3 w-3 shrink-0 text-danger/80" />}
            {user.broadcasting && <Radio className="h-3 w-3 shrink-0 text-ok" />}
            {user.screenSharing && <MonitorUp className="h-3 w-3 shrink-0 text-accent" />}
            {user.deafened && <HeadphoneOff className="h-3 w-3 shrink-0 text-danger/80" />}
            {(user.muted || user.serverMuted) && (
              <MicOff
                className={cn('h-3 w-3 shrink-0', user.serverMuted ? 'text-danger' : 'text-muted')}
              />
            )}
          </span>
        );
      })}
      {menu && (
        <VolumeMenu
          user={menu.user}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  users,
  speaking,
  unread,
  connected,
  active,
  onClick,
}: {
  channel: Channel;
  users: OnlineUser[];
  speaking: Set<string>;
  unread: number;
  connected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = channel.type === 'voice' ? Volume2 : Hash;
  const drag = useContext(DragContext);
  const acceptsDrop = Boolean(
    drag?.user && channel.type === 'voice' && drag.user.channelId !== channel.id,
  );
  const dropActive = acceptsDrop && drag?.overChannelId === channel.id;

  return (
    <div
      onDragOver={
        acceptsDrop
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              drag?.setOver(channel.id);
            }
          : undefined
      }
      onDragLeave={acceptsDrop ? () => drag?.setOver(null) : undefined}
      onDrop={
        acceptsDrop
          ? (event) => {
              event.preventDefault();
              drag?.setOver(null);
              if (drag?.user) moveUserToChannel(drag.user, channel);
              drag?.end();
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'sidebar-item group',
          active && 'sidebar-item-active',
          channel.type === 'voice' && connected && 'text-slate-100',
          dropActive && 'bg-accent/15 ring-1 ring-inset ring-accent/60',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            channel.type === 'voice' && connected ? 'text-ok' : 'text-muted',
          )}
        />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {channel.passwordProtected && (
          <span className="shrink-0 text-muted" title="Канал защищён паролем">
            <Lock className="h-3 w-3" />
          </span>
        )}
        {channel.type === 'voice' && connected && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
        )}
        {channel.type === 'voice' && users.length > 0 && (
          <span className="shrink-0 text-[10px] font-semibold text-muted">{users.length}</span>
        )}
        {channel.type === 'text' && unread > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {channel.type === 'voice' && !connected && users.length > 0 && (
          <span className="hidden items-center gap-1 text-[10px] text-muted group-hover:flex">
            войти
          </span>
        )}
      </button>
      {channel.type === 'voice' && users.length > 0 && (
        <>
          <div className="mb-1 hidden space-y-0.5 md:block">
            {users.map((user) => (
              <ParticipantRow
                key={user.sessionId}
                user={user}
                speaking={speaking.has(user.sessionId)}
              />
            ))}
          </div>
          <div className="md:hidden">
            <CompactParticipants users={users} speaking={speaking} />
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children, onAdd }: { children: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted/80">
        {children}
      </span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded p-1 text-muted transition hover:bg-panel3 hover:text-slate-100"
          title="Создать канал"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Sidebar({
  onOpenSettings,
  onOpenAdmin,
  onNavigate,
}: {
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onNavigate?: () => void;
}) {
  const me = useApp((state) => state.me);
  const roles = useApp((state) => state.roles);
  const users = useApp((state) => state.users);
  const channels = useApp((state) => state.channels);
  const config = useApp((state) => state.config);
  const activeChannelId = useApp((state) => state.activeChannelId);
  const unread = useApp((state) => state.unread);
  const speaking = useApp((state) => state.speaking);
  const voiceChannelId = useApp((state) => state.voice.channelId);
  const connection = useApp((state) => state.connection);

  const speakingSet = new Set(speaking);
  const voiceChannels = channels.filter((channel) => channel.type === 'voice');
  const textChannels = channels.filter((channel) => channel.type === 'text');
  const canManageChannels = hasPermission(me, roles, 'channels');

  const [dragUser, setDragUser] = useState<OnlineUser | null>(null);
  const [overChannelId, setOverChannelId] = useState<string | null>(null);
  const dragState = useMemo<DragState>(
    () => ({
      user: dragUser,
      overChannelId,
      start: (event, user) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', user.id);
        setDragUser(user);
        setOverChannelId(null);
      },
      end: () => {
        setDragUser(null);
        setOverChannelId(null);
      },
      setOver: setOverChannelId,
    }),
    [dragUser, overChannelId],
  );

  function handleChannel(channel: Channel) {
    if (channel.type === 'voice' && voiceChannelId !== channel.id) {
      void joinVoice(channel.id);
    } else {
      selectChannel(channel.id);
    }
    onNavigate?.();
  }

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-16 items-center gap-3 border-b border-line px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 shadow-glow">
          <Radio className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold tracking-wide text-white">
            {serverLabel(config?.serverName)}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connection === 'online'
                  ? 'bg-ok'
                  : connection === 'connecting'
                    ? 'bg-warn animate-pulse-soft'
                    : 'bg-danger',
              )}
            />
            {connection === 'online'
              ? `${users.length} в сети`
              : connection === 'connecting'
                ? 'подключение'
                : 'нет связи'}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <DragContext.Provider value={dragState}>
        <SectionTitle onAdd={canManageChannels ? onOpenAdmin : undefined}>Голосовые каналы</SectionTitle>
        <div className="space-y-0.5">
          {voiceChannels.map((channel) => {
            const inChannel = users.filter((user) => user.channelId === channel.id);
            return (
              <ChannelRow
                key={channel.id}
                channel={channel}
                users={inChannel}
                speaking={speakingSet}
                unread={0}
                connected={voiceChannelId === channel.id}
                active={activeChannelId === channel.id}
                onClick={() => handleChannel(channel)}
              />
            );
          })}
        </div>

        <SectionTitle onAdd={canManageChannels ? onOpenAdmin : undefined}>Текстовые каналы</SectionTitle>
        <div className="space-y-0.5">
          {textChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              users={[]}
              speaking={speakingSet}
              unread={unread[channel.id] ?? 0}
              connected={false}
              active={activeChannelId === channel.id}
              onClick={() => handleChannel(channel)}
            />
          ))}
        </div>

        {channels.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">
            Каналов пока нет. Администратор может создать их в панели управления.
          </p>
        )}
        </DragContext.Provider>
      </div>

      <UserBar onOpenSettings={onOpenSettings} onOpenAdmin={onOpenAdmin} />
    </aside>
  );
}
