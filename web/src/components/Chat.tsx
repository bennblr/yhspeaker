import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Shield, ShieldCheck, Trash2 } from 'lucide-react';
import type { ChatMessage } from '@tsds/shared';
import { Avatar } from './Avatar';
import { LabelBadge } from './LabelBadge';
import { useApp } from '../lib/store';
import { sendChatMessage } from '../lib/actions';
import { getSocket } from '../lib/socket';
import { useCan } from '../lib/roles';
import { cn, formatDate, formatTime } from '../lib/utils';

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

const EMPTY_MESSAGES: ChatMessage[] = [];

export function Chat({ channelId, placeholder }: { channelId: string; placeholder?: string }) {
  const messages = useApp((state) => state.messages[channelId] ?? EMPTY_MESSAGES);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const canModerate = useCan('moderate');

  useEffect(() => {
    setText('');
    stickToBottom.current = true;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [channelId]);

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

  function submit() {
    const value = text.trim();
    if (!value) return;
    sendChatMessage(channelId, value);
    setText('');
    stickToBottom.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function deleteMessage(message: ChatMessage) {
    if (!canModerate) return;
    if (!window.confirm('Удалить это сообщение?')) return;
    getSocket()?.emit('admin:deleteMessage', {
      channelId: message.channelId,
      messageId: message.id,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            <p className="text-sm font-medium text-slate-300">Здесь пока тихо</p>
            <p className="max-w-[240px] text-xs leading-relaxed">
              Напишите первое сообщение — его увидят все участники сервера.
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
                previous.userId === message.userId &&
                message.ts - previous.ts < 5 * 60 * 1000;
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
                      <Avatar id={message.userId} name={message.displayName} size="sm" />
                    )}
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                          <span
                            className={cn(
                              'text-[13px] font-semibold',
                              message.role === 'admin'
                                ? 'text-accent'
                                : message.role === 'moderator'
                                  ? 'text-ok'
                                  : message.role === 'guest'
                                    ? 'text-amber-300'
                                    : 'text-slate-100',
                            )}
                          >
                            {message.displayName}
                          </span>
                          <LabelBadge label={message.label} />
                          {message.role === 'admin' && (
                            <span className="flex items-center gap-1 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                              <Shield className="h-2.5 w-2.5" />
                              админ
                            </span>
                          )}
                          {message.role === 'moderator' && (
                            <span className="flex items-center gap-1 rounded bg-ok/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ok">
                              <ShieldCheck className="h-2.5 w-2.5" />
                              модер
                            </span>
                          )}
                          {message.role === 'guest' && (
                            <span className="rounded bg-amber-400/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                              гость
                            </span>
                          )}
                          <span className="text-[10px] text-muted">{formatTime(message.ts)}</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-300">
                        {message.text}
                      </p>
                    </div>
                    {canModerate && (
                      <button
                        onClick={() => deleteMessage(message)}
                        className="absolute right-2 top-1.5 rounded-md p-1 text-muted opacity-0 transition hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
                        title="Удалить сообщение"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
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
            placeholder={placeholder ?? 'Написать сообщение'}
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
