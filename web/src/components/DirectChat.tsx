import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, Send, Shield, ShieldCheck } from 'lucide-react';
import type { DirectMessage, DmParticipant } from '@tsds/shared';
import { Avatar } from './Avatar';
import { ChatText } from './ChatText';
import { LabelBadge } from './LabelBadge';
import { useApp } from '../lib/store';
import {
  closeDirectChat,
  loadDmHistory,
  sendDirectMessage,
} from '../lib/actions';
import { cn, formatDate, formatTime } from '../lib/utils';

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

const EMPTY_MESSAGES: DirectMessage[] = [];

export function DirectChat({ peer }: { peer: DmParticipant }) {
  const messages = useApp((state) => state.dmMessages[peer.id] ?? EMPTY_MESSAGES);
  const me = useApp((state) => state.me);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    setText('');
    stickToBottom.current = true;
    loadDmHistory(peer.id);
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [peer.id]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }, [text]);

  function submit(): void {
    const value = text.trim();
    if (!value) return;
    sendDirectMessage(peer.id, value);
    setText('');
    stickToBottom.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0e14]">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-panel/50 px-3 sm:px-5">
        <button
          type="button"
          className="icon-btn md:hidden"
          onClick={closeDirectChat}
          aria-label="Вернуться к каналу"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Avatar id={peer.id} name={peer.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-sm font-semibold text-slate-100">{peer.displayName}</h1>
            <LabelBadge label={peer.label} />
            {peer.role === 'admin' && <Shield className="h-3 w-3 shrink-0 text-accent" />}
            {peer.role === 'moderator' && (
              <ShieldCheck className="h-3 w-3 shrink-0 text-ok" />
            )}
          </div>
          <p className="truncate text-[11px] text-muted">Личные сообщения</p>
        </div>
        <button
          type="button"
          className="btn-ghost hidden h-8 px-3 text-xs md:flex"
          onClick={closeDirectChat}
        >
          К каналу
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel2">
              <MessageSquare className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-slate-300">Начните переписку</p>
            <p className="max-w-[280px] text-xs leading-relaxed">
              Сообщения в личном чате видите только вы и {peer.displayName}.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || !sameDay(previous.ts, message.ts);
              const grouped =
                !newDay &&
                previous &&
                previous.from.id === message.from.id &&
                message.ts - previous.ts < 5 * 60 * 1000;
              const own = message.from.id === me?.id;
              return (
                <div key={message.id}>
                  {newDay && (
                    <div className="my-3 flex items-center gap-3">
                      <div className="h-px flex-1 bg-line" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                        {formatDate(message.ts)}
                      </span>
                      <div className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'group relative flex gap-3 rounded-lg px-2 py-1 transition hover:bg-white/[0.025]',
                      grouped ? 'mt-0' : 'mt-2',
                    )}
                  >
                    {grouped ? (
                      <div className="w-8 shrink-0 pt-1 text-right text-[10px] text-transparent group-hover:text-muted">
                        {formatTime(message.ts)}
                      </div>
                    ) : (
                      <Avatar
                        id={message.from.id}
                        name={message.from.displayName}
                        size="sm"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                          <span
                            className={cn(
                              'text-[13px] font-semibold',
                              own
                                ? 'text-accent'
                                : message.from.role === 'admin'
                                  ? 'text-accent'
                                  : message.from.role === 'moderator'
                                    ? 'text-ok'
                                    : message.from.role === 'guest'
                                      ? 'text-amber-300'
                                      : 'text-slate-100',
                            )}
                          >
                            {message.from.displayName}
                          </span>
                          <LabelBadge label={message.from.label} />
                          {message.from.role === 'admin' && (
                            <span className="flex items-center gap-1 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                              <Shield className="h-2.5 w-2.5" />
                              админ
                            </span>
                          )}
                          {message.from.role === 'moderator' && (
                            <span className="flex items-center gap-1 rounded bg-ok/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ok">
                              <ShieldCheck className="h-2.5 w-2.5" />
                              модер
                            </span>
                          )}
                          {message.from.role === 'guest' && (
                            <span className="rounded bg-amber-400/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                              гость
                            </span>
                          )}
                          <span className="text-[10px] text-muted">{formatTime(message.ts)}</span>
                        </div>
                      )}
                      <ChatText text={message.text} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-panel2 px-3 py-2 focus-within:border-accent/60">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={`Сообщение для ${peer.displayName}`}
            className="max-h-[140px] min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-sm text-slate-100 placeholder:text-muted/70 outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="icon-btn h-8 w-8 text-accent hover:bg-accent/15 disabled:opacity-40"
            title="Отправить (Enter)"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted/70">
          Enter — отправить · Shift + Enter — новая строка
        </p>
      </div>
    </div>
  );
}
