import {
  createDeepFilterNetAudioWorklet,
  DEEPFILTERNET_SAMPLE_RATE,
} from '@workadventure/noise-suppression/deepfilternet';
import { sensitivityThreshold } from './settings';

// Гейт работает в аудиопотоке, поэтому не зависит от троттлинга таймеров в фоне.
const MIC_GATE_WORKLET = `
class MicGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: 0.012, minValue: 0.0001, maxValue: 1, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Уровень входящего голоса: не даём открыть гейт на остатках эха от динамиков.
      { name: 'remote', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.gain = 1;
    this.hold = 0;
    this.remote = 0;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const source = input[0];
    const threshold = parameters.threshold[0];
    const enabled = parameters.enabled[0] >= 0.5;
    const remoteParam = parameters.remote[0];
    let sum = 0;
    if (source) {
      for (let i = 0; i < source.length; i += 1) sum += source[i] * source[i];
    }
    const rms = source && source.length ? Math.sqrt(sum / source.length) : 0;
    const dt = (source ? source.length : 128) / sampleRate;
    // Плавно спадает, когда входящая речь стихает, чтобы гейт не «дребезжал».
    this.remote = Math.max(remoteParam, this.remote * Math.exp(-dt / 0.35));
    // Ограничиваем добавку: не больше +8 дБ к пользовательскому порогу.
    const guard = Math.min(threshold * 2.5, this.remote * 0.15);
    const openThreshold = Math.max(threshold, guard);
    if (rms >= openThreshold) this.hold = 0.2;
    else this.hold = Math.max(0, this.hold - dt);
    const target = !enabled || this.hold > 0 ? 1 : 0;
    const attack = Math.exp(-1 / (sampleRate * 0.008));
    const release = Math.exp(-1 / (sampleRate * 0.09));
    let gain = this.gain;
    const frames = source ? source.length : 128;
    for (let i = 0; i < frames; i += 1) {
      const coef = target > gain ? attack : release;
      gain = target + (gain - target) * coef;
      for (let ch = 0; ch < output.length; ch += 1) {
        const src = input[Math.min(ch, input.length - 1)];
        output[ch][i] = src ? src[i] * gain : 0;
      }
    }
    this.gain = gain;
    return true;
  }
}
registerProcessor('yh-mic-gate', MicGateProcessor);
`;

let gateModuleUrl: string | null = null;

function micGateModuleUrl(): string {
  if (!gateModuleUrl) {
    gateModuleUrl = URL.createObjectURL(
      new Blob([MIC_GATE_WORKLET], { type: 'application/javascript' }),
    );
  }
  return gateModuleUrl;
}

export async function createMicGateNode(ctx: AudioContext): Promise<AudioWorkletNode | null> {
  try {
    await ctx.audioWorklet.addModule(micGateModuleUrl());
    return new AudioWorkletNode(ctx, 'yh-mic-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
  } catch (error) {
    console.warn('[mic] gate worklet unavailable', error);
    return null;
  }
}

export function applyMicGate(
  gate: AudioWorkletNode | null,
  micSensitivity: number,
  openMode: boolean,
): void {
  if (!gate) return;
  const threshold = gate.parameters.get('threshold');
  const enabled = gate.parameters.get('enabled');
  if (threshold) threshold.value = sensitivityThreshold(micSensitivity);
  if (enabled) enabled.value = openMode ? 1 : 0;
}

export function applyRemoteLevel(gate: AudioWorkletNode | null, level: number): void {
  if (!gate) return;
  const param = gate.parameters.get('remote');
  if (param) param.value = Math.max(0, Math.min(1, level));
}

export function createNoiseFilter(ctx: AudioContext): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 120;
  filter.Q.value = 0.7;
  return filter;
}

// DeepFilterNet3 — полноценная нейросетевая модель (48 кГц) с паузным гейтом:
// она не только вычитает ровный фон, но и не даёт открыться на щелчках клавиатуры,
// а кашель и прочие неречевые звуки уходят в паузы между словами.
export interface NoiseSuppressorNode {
  node: AudioWorkletNode;
  ready: Promise<unknown>;
  destroy: () => void;
}

export async function createNoiseSuppressorNode(
  ctx: AudioContext,
): Promise<NoiseSuppressorNode | null> {
  // Модель требует строго 48 кГц; при другой частоте контекста не рискуем.
  if (ctx.sampleRate !== DEEPFILTERNET_SAMPLE_RATE) return null;
  try {
    const handle = await createDeepFilterNetAudioWorklet(ctx, {
      // Один кадр упреждения вместо трёх: −20 мс задержки, атака слов сохраняется.
      pauseGateLookaheadFrames: 1,
      // Двух речевых кадров подряд мало для короткого щелчка клавиши.
      minSpeechFrames: 2,
      // Чуть сильнее режем неречевой фон, пока человек говорит (по умолчанию 25 дБ).
      speechAttenuationDb: 30,
    });
    return {
      node: handle.node,
      ready: handle.ready,
      destroy: () => {
        try {
          handle.dispose();
        } catch {
          /* уже уничтожен */
        }
      },
    };
  } catch (error) {
    console.warn('[mic] DeepFilterNet3 unavailable', error);
    return null;
  }
}

// Модель весит ~23 МБ, поэтому скачиваем и компилируем её в простое сразу
// после входа: первое подключение к каналу не должно ждать загрузку.
// Скомпилированный wasm и байты модели пакет кеширует на уровне модуля,
// поэтому реальный микрофонный контекст получит их уже готовыми.
let preloadPromise: Promise<void> | null = null;

export function preloadNoiseSuppressor(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      let ctx: AudioContext | null = null;
      try {
        ctx = new Ctx({ sampleRate: DEEPFILTERNET_SAMPLE_RATE }) as AudioContext;
        const handle = await createDeepFilterNetAudioWorklet(ctx);
        void handle.ready.catch(() => undefined);
        handle.dispose();
      } catch (error) {
        preloadPromise = null;
        console.warn('[mic] DeepFilterNet3 preload failed', error);
      } finally {
        if (ctx) void ctx.close().catch(() => undefined);
      }
    })();
  }
  return preloadPromise;
}

// Модель работает только с 48 кГц, поэтому микрофонный контекст фиксируем
// на 48 кГц — это ещё и родная частота Opus.
export function createMicAudioContext(): AudioContext {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  try {
    return new Ctx({ latencyHint: 'interactive', sampleRate: 48_000 }) as AudioContext;
  } catch {
    return new Ctx({ latencyHint: 'interactive' }) as AudioContext;
  }
}
