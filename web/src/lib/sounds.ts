import { useApp } from './store';

// Короткие синтезированные сигналы: не нужны аудиофайлы, и их нельзя
// «не догрузить». Контекст создаём лениво и будим по первому жесту.
export type SoundCue = 'connectionLost' | 'channelJoin' | 'channelLeave';

let context: AudioContext | null = null;
let lastCue: SoundCue | null = null;
let lastPlayedAt = 0;

function audioContext(): AudioContext | null {
  if (context && context.state !== 'closed') return context;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    context = new Ctx({ latencyHint: 'interactive' });
  } catch {
    context = null;
  }
  return context;
}

function enabled(cue: SoundCue): boolean {
  const settings = useApp.getState().settings;
  if (cue === 'connectionLost') return settings.soundConnectionLost;
  if (cue === 'channelJoin') return settings.soundChannelJoin;
  return settings.soundChannelLeave;
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine',
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

export function playSound(cue: SoundCue): void {
  if (!enabled(cue)) return;
  const now = performance.now();
  // Одинаковый сигнал не должен накладываться сам на себя: события
  // подключения приходят пачками.
  if (cue === lastCue && now - lastPlayedAt < 700) return;
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
  const start = ctx.currentTime + 0.01;
  if (cue === 'channelJoin') {
    tone(ctx, 659, start, 0.09, 0.07);
    tone(ctx, 988, start + 0.085, 0.11, 0.06);
  } else if (cue === 'channelLeave') {
    tone(ctx, 659, start, 0.09, 0.06);
    tone(ctx, 440, start + 0.085, 0.11, 0.055);
  } else {
    tone(ctx, 440, start, 0.12, 0.08, 'triangle');
    tone(ctx, 330, start + 0.13, 0.12, 0.075, 'triangle');
    tone(ctx, 220, start + 0.26, 0.18, 0.07, 'triangle');
  }
  lastCue = cue;
  lastPlayedAt = now;
}

// Автовоспроизведение разрешено только после жеста пользователя.
export function unlockSounds(): void {
  const ctx = audioContext();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}
