import { HeadphoneOff, Headphones, LogOut, Mic, MicOff, MonitorUp } from 'lucide-react';
import { isSelfMicMuted, useApp } from '../lib/store';
import { leaveVoice, toggleDeafen, toggleMic, toggleScreenShare } from '../lib/actions';
import { voice } from '../lib/voice';
import { cn } from '../lib/utils';

export function MobileVoiceBar() {
  const voiceState = useApp((state) => state.voice);
  const me = useApp((state) => state.me);
  const settings = useApp((state) => state.settings);
  const muted = useApp((state) => isSelfMicMuted(state));

  const connecting = voiceState.connecting;
  const ptt = settings.mode === 'ptt';
  const serverMuted = Boolean(me?.serverMuted);
  const micDisabled = connecting || serverMuted;
  const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  const micLabel = serverMuted
    ? 'Микрофон отключён администратором'
    : ptt
      ? voiceState.pttActive
        ? 'Говорите…'
        : 'Удерживайте, чтобы говорить'
      : muted
        ? 'Включить микрофон'
        : 'Выключить микрофон';

  function pttDown(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!voiceState.micReady) void voice.enableMic();
    voice.setPtt(true);
  }

  function pttUp(): void {
    voice.setPtt(false);
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-[#0d1017] px-2.5 py-2 md:hidden">
      <button
        type="button"
        disabled={micDisabled}
        onPointerDown={ptt ? pttDown : undefined}
        onPointerUp={ptt ? pttUp : undefined}
        onPointerCancel={ptt ? pttUp : undefined}
        onLostPointerCapture={ptt ? pttUp : undefined}
        onClick={ptt ? undefined : () => void toggleMic()}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={micLabel}
        className={cn(
          'flex h-11 min-w-0 flex-1 touch-none select-none items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition',
          ptt && voiceState.pttActive
            ? 'border-ok/50 bg-ok/20 text-ok'
            : muted
              ? 'border-danger/30 bg-danger/10 text-danger'
              : 'border-ok/30 bg-ok/10 text-ok',
          micDisabled && 'opacity-50',
        )}
      >
        {muted ? <MicOff className="h-5 w-5 shrink-0" /> : <Mic className="h-5 w-5 shrink-0" />}
        <span className="truncate">{micLabel}</span>
      </button>

      <button
        type="button"
        onClick={toggleDeafen}
        aria-label={voiceState.deafened ? 'Включить звук' : 'Выключить звук'}
        className={cn(
          'icon-btn h-11 w-11 shrink-0 rounded-xl border border-line bg-panel2',
          voiceState.deafened && 'text-danger',
        )}
      >
        {voiceState.deafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
      </button>

      {canShareScreen && (
        <button
          type="button"
          onClick={toggleScreenShare}
          aria-label={voiceState.localScreen ? 'Остановить показ экрана' : 'Показать экран'}
          className={cn(
            'icon-btn h-11 w-11 shrink-0 rounded-xl border border-line bg-panel2',
            voiceState.localScreen && 'text-accent',
          )}
        >
          <MonitorUp className="h-5 w-5" />
        </button>
      )}

      <button
        type="button"
        onClick={leaveVoice}
        aria-label="Отключиться от канала"
        className="icon-btn h-11 w-11 shrink-0 rounded-xl border border-danger/25 bg-danger/10 text-danger"
      >
        <LogOut className="h-5 w-5" />
      </button>
    </div>
  );
}
