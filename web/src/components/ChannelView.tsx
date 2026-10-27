import { Hash, LogOut, Users, Volume2 } from 'lucide-react';
import type { Channel } from '@tsds/shared';
import { Chat } from './Chat';
import { BroadcastBanner, VoiceStage } from './VoiceStage';
import { useApp } from '../lib/store';
import { leaveVoice } from '../lib/actions';
import { cn } from '../lib/utils';

export function ChannelView({ channel }: { channel: Channel }) {
  const users = useApp((state) => state.users);
  const voiceChannelId = useApp((state) => state.voice.channelId);
  const connected = voiceChannelId === channel.id;
  const inChannel = users.filter((user) => user.channelId === channel.id);
  const isVoice = channel.type === 'voice';
  const Icon = isVoice ? Volume2 : Hash;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0e14]">
      <header className="hidden h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-panel/50 px-4 backdrop-blur sm:px-5 md:flex">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2 text-muted">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-100">{channel.name}</h1>
            <p className="truncate text-[11px] text-muted">
              {isVoice
                ? connected
                  ? `Голос подключён · ${inChannel.length} в канале`
                  : `${inChannel.length} в канале`
                : 'Текстовый канал'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isVoice ? (
            connected ? (
              <button className="btn-ghost h-8 px-3 text-xs" onClick={leaveVoice}>
                <LogOut className="h-3.5 w-3.5" />
                Отключиться
              </button>
            ) : (
              <span className="hidden items-center gap-1.5 rounded-full border border-line bg-panel2 px-3 py-1.5 text-[11px] text-muted sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-muted/60" />
                вы не в голосовом канале
              </span>
            )
          ) : (
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-panel2 px-3 py-1.5 text-[11px] text-muted sm:flex">
              <Users className="h-3.5 w-3.5" />
              {users.length} в сети
            </span>
          )}
        </div>
      </header>

      <BroadcastBanner />

      {isVoice ? (
        <div className={cn('flex min-h-0 flex-1 flex-col lg:flex-row')}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <VoiceStage channel={channel} />
          </div>
          <div className="flex h-[42%] min-h-[220px] shrink-0 flex-col border-t border-line bg-panel/40 lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Hash className="h-3.5 w-3.5 text-muted" />
              <span className="text-xs font-semibold text-slate-300">Чат канала</span>
            </div>
            <Chat channelId={channel.id} placeholder={`Сообщение в «${channel.name}»`} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <Chat channelId={channel.id} placeholder={`Сообщение в #${channel.name}`} />
        </div>
      )}
    </div>
  );
}
