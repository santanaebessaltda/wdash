/**
 * Detector de 2 palmas via AnalyserNode.
 *
 * Não basta “volume alto”: exige impulso curto (palma) bem acima do ruído de fundo,
 * com queda entre as duas batidas. Barulho contínuo / fala / teclado não devem abrir a voz.
 */

export interface ClapDetectorHandle {
  stop: () => void;
}

export interface ClapDetectorOptions {
  /** Pico mínimo absoluto (0–1). */
  threshold?: number;
  /** Pico precisa ser ≥ ambientRms × este fator. */
  snrFactor?: number;
  /** Intervalo mínimo entre as duas palmas (ms). */
  minGapMs?: number;
  /** Intervalo máximo entre as duas palmas (ms). */
  maxGapMs?: number;
  /** Duração máxima do impulso acima do limiar (ms) — palma é curta. */
  maxImpulseMs?: number;
  /** Cooldown após disparar (ms). */
  cooldownMs?: number;
}

const DEFAULTS = {
  threshold: 0.55,
  snrFactor: 7,
  minGapMs: 160,
  maxGapMs: 750,
  maxImpulseMs: 90,
  cooldownMs: 3200,
};

function rmsOf(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] ?? 0);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Fração da energia acima de ~2 kHz (palma tem “estalo”; hum contínuo não). */
function highBandRatio(analyser: AnalyserNode, freq: Uint8Array<ArrayBuffer>): number {
  analyser.getByteFrequencyData(freq);
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  let hi = 0;
  let all = 0;
  for (let i = 0; i < freq.length; i++) {
    const e = freq[i] ?? 0;
    all += e;
    if (i * binHz >= 2000) hi += e;
  }
  return all > 0 ? hi / all : 0;
}

export async function startClapDetector(
  onDoubleClap: () => void,
  opts: ClapDetectorOptions = {},
): Promise<ClapDetectorHandle | null> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;

  const threshold = opts.threshold ?? DEFAULTS.threshold;
  const snrFactor = opts.snrFactor ?? DEFAULTS.snrFactor;
  const minGapMs = opts.minGapMs ?? DEFAULTS.minGapMs;
  const maxGapMs = opts.maxGapMs ?? DEFAULTS.maxGapMs;
  const maxImpulseMs = opts.maxImpulseMs ?? DEFAULTS.maxImpulseMs;
  const cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;

  let stream: MediaStream;
  try {
    // Sem AGC: ganho automático transforma barulho de fundo em “palma”.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch {
    return null;
  }

  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.05;
  source.connect(analyser);

  const time = new Float32Array(analyser.fftSize);
  const freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

  let ambientRms = 0.015;
  let lastClapAt = 0;
  let awaitingSecond = false;
  let lastFireAt = 0;
  let raf = 0;
  let armed = true;

  /** Estado do impulso atual (borda de subida → precisa cair rápido). */
  let impulseOpen = false;
  let impulseStart = 0;
  let impulsePeak = 0;
  let impulseHigh = 0;

  const fireClapCandidate = (now: number) => {
    // Impulso curto + bastante agudo + bem acima do ambiente.
    const floor = Math.max(threshold, ambientRms * snrFactor);
    if (impulsePeak < floor) return;
    if (impulseHigh < 0.35) return;
    const dur = now - impulseStart;
    if (dur > maxImpulseMs) return;

    if (now - lastFireAt < cooldownMs) return;

    if (!awaitingSecond) {
      awaitingSecond = true;
      lastClapAt = now;
      return;
    }

    const gap = now - lastClapAt;
    if (gap >= minGapMs && gap <= maxGapMs) {
      awaitingSecond = false;
      lastFireAt = now;
      onDoubleClap();
      return;
    }
    if (gap > maxGapMs) {
      awaitingSecond = true;
      lastClapAt = now;
    }
  };

  const tick = () => {
    if (!armed) return;
    analyser.getFloatTimeDomainData(time);
    const peak = peakOf(time);
    const rms = rmsOf(time);
    const now = performance.now();

    // Ambiente sobe/desce devagar — só quando não estamos no meio de um impulso.
    if (!impulseOpen && peak < threshold * 0.45) {
      ambientRms = ambientRms * 0.98 + rms * 0.02;
    }

    const floor = Math.max(threshold, ambientRms * snrFactor);
    const above = peak >= floor;

    if (above && !impulseOpen) {
      impulseOpen = true;
      impulseStart = now;
      impulsePeak = peak;
      impulseHigh = highBandRatio(analyser, freq);
    } else if (impulseOpen && above) {
      if (peak > impulsePeak) impulsePeak = peak;
      const hi = highBandRatio(analyser, freq);
      if (hi > impulseHigh) impulseHigh = hi;
      // Impulso longo demais = fala/ruído contínuo — descarta.
      if (now - impulseStart > maxImpulseMs) {
        impulseOpen = false;
        impulsePeak = 0;
      }
    } else if (impulseOpen && !above) {
      fireClapCandidate(now);
      impulseOpen = false;
      impulsePeak = 0;
      impulseHigh = 0;
    }

    if (awaitingSecond && now - lastClapAt > maxGapMs) {
      awaitingSecond = false;
    }

    raf = requestAnimationFrame(tick);
  };

  const resume = () => {
    if (ctx.state === "suspended") void ctx.resume();
  };
  resume();
  document.addEventListener("visibilitychange", resume);
  raf = requestAnimationFrame(tick);

  return {
    stop: () => {
      armed = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", resume);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* já desconectado */
      }
      void ctx.close();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
