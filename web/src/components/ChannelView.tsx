import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Hash, LogOut, Users, Volume2 } from 'lucide-react';
import type { Channel } from '@tsds/shared';
import { Chat } from './Chat';
import { BroadcastBanner, VoiceStage } from './VoiceStage';
import { useApp } from '../lib/store';
import { leaveVoice } from '../lib/actions';
import { desktop } from '../lib/desktop';
import { cn } from '../lib/utils';

interface DesktopInfo {
  available: boolean;
  size: number;
}

function isDesktopBrowser(): boolean {
  if (desktop || typeof window === 'undefined') return false;
  if (!/Windows/i.test(navigator.userAgent)) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function DesktopDownloadBanner() {
  const [enabled] = useState(isDesktopBrowser);
  const [info, setInfo] = useState<DesktopInfo | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch('/api/desktop')
      .then((response) => (response.ok ? (response.json() as Promise<DesktopInfo>) : null))
      .then((data) => {
        if (!cancelled && data?.available) setInfo(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || !info) return null;
  const sizeMb = Math.max(1, Math.round(info.size / (1024 * 1024)));

  return (
    <div className="hidden items-center justify-between gap-3 border-b border-line bg-accent/[0.06] px-3 py-2 md:flex md:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Download className="h-4 w-4 shrink-0 text-accent" />
        <p className="min-w-0 text-xs text-slate-300">
          <span className="font-semibold text-slate-100">Приложение для Windows</span>
          <span className="text-muted">
            {' '}
            · глобальные горячие клавиши и работа в фоне · {sizeMb} МБ
          </span>
        </p>
      </div>
      <a className="btn-primary h-8 shrink-0 px-3 text-xs" href="/download/windows" download>
        Скачать .exe
      </a>
    </div>
  );
}

export function ChannelView({ channel }: { channel: Channel }) {
  const users = useApp((state) => state.users);
  const voiceChannelId = useApp((state) => state.voice.channelId);
  const connected = voiceChannelId === channel.id;
  const inChannel = users.filter((user) => user.channelId === channel.id);
  const isVoice = channel.type === 'voice';
  const Icon = isVoice ? Volume2 : Hash;
  const [chatExpanded, setChatExpanded] = useState(false);

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
      {isVoice && <DesktopDownloadBanner />}

      {isVoice ? (
        <div className={cn('flex min-h-0 flex-1 flex-col lg:flex-row')}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <VoiceStage channel={channel} />
          </div>
          <button
            type="button"
            onClick={() => setChatExpanded(true)}
            aria-label="Открыть чат канала на весь экран"
            className="flex shrink-0 items-center gap-2 border-t border-line bg-panel/60 px-4 py-3 text-xs font-semibold text-slate-300 transition hover:bg-panel2 lg:hidden"
          >
            <Hash className="h-3.5 w-3.5 text-muted" />
            Чат канала
            <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-muted">
              Открыть
              <ChevronUp className="h-3.5 w-3.5" />
            </span>
          </button>
          <div
            className={cn(
              'flex min-h-0 flex-col border-line lg:static lg:h-auto lg:w-[360px] lg:shrink-0 lg:border-l lg:border-t-0',
              chatExpanded
                ? 'fixed inset-0 z-40 bg-[#0b0e14] lg:bg-panel/40'
                : 'hidden bg-panel/40 lg:flex',
            )}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
              <Hash className="h-3.5 w-3.5 text-muted" />
              <span className="text-xs font-semibold text-slate-300">Чат канала</span>
              <button
                type="button"
                onClick={() => setChatExpanded(false)}
                aria-label="Свернуть чат"
                className="icon-btn ml-auto h-8 w-8 lg:hidden"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
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
