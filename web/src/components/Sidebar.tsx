import {
  Hash,
  HeadphoneOff,
  Lock,
  MicOff,
  MonitorUp,
  Plus,
  Radio,
  Shield,
  Volume2,
} from 'lucide-react';
import { hasPermission, type Channel, type OnlineUser } from '@tsds/shared';
import { Avatar } from './Avatar';
import { UserBar } from './UserBar';
import { useApp } from '../lib/store';
import { cn, serverLabel } from '../lib/utils';
import { joinVoice, selectChannel } from '../lib/actions';
import { primaryRole, roleLabel } from '../lib/roles';

function ParticipantRow({ user, speaking }: { user: OnlineUser; speaking: boolean }) {
  const roles = useApp((state) => state.roles);
  const primary = user.role === 'admin' ? null : primaryRole(user, roles);

  return (
    <div
      className="flex items-center gap-2 rounded-md py-1 pl-[30px] pr-2 text-[12px] text-slate-400 transition hover:bg-white/[0.03]"
      title={`${user.displayName} · ${roleLabel(user, roles)}${user.broadcasting ? ' — вещает' : ''}`}
    >
      <Avatar id={user.id} name={user.displayName} size="xs" speaking={speaking} />
      <span
        className={cn('min-w-0 flex-1 truncate', speaking && 'text-ok')}
        style={!speaking && primary ? { color: primary.color } : undefined}
      >
        {user.displayName}
      </span>
      {user.role === 'admin' && (
        <span title="Администратор" className="shrink-0">
          <Shield className="h-3 w-3 text-accent" />
        </span>
      )}
      {primary && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: primary.color }}
        />
      )}
      <span className="flex items-center gap-1">
        {user.broadcasting && <Radio className="h-3 w-3 text-ok" />}
        {user.screenSharing && <MonitorUp className="h-3 w-3 text-accent" />}
        {user.deafened && <HeadphoneOff className="h-3 w-3 text-danger/80" />}
        {(user.muted || user.serverMuted) && (
          <MicOff className={cn('h-3 w-3', user.serverMuted ? 'text-danger' : 'text-muted')} />
        )}
      </span>
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
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'sidebar-item group',
          active && 'sidebar-item-active',
          channel.type === 'voice' && connected && 'text-slate-100',
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
        <div className="mb-1 space-y-0.5">
          {users.map((user) => (
            <ParticipantRow key={user.id} user={user} speaking={speaking.has(user.id)} />
          ))}
        </div>
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
      </div>

      <UserBar onOpenSettings={onOpenSettings} onOpenAdmin={onOpenAdmin} />
    </aside>
  );
}
