/**
 * Detector de 2 palmas via AnalyserNode.
 * Limiar e janela calibráveis; ambiente barulhento pode gerar falso positivo —
 * o botão e a palavra de ativação continuam disponíveis.
 */

export interface ClapDetectorHandle {
  stop: () => void;
}

export interface ClapDetectorOptions {
  /** Pico mínimo (0–1) para contar como palma. */
  threshold?: number;
  /** Intervalo mínimo entre as duas palmas (ms). */
  minGapMs?: number;
  /** Intervalo máximo entre as duas palmas (ms). */
  maxGapMs?: number;
  /** Cooldown após disparar (ms). */
  cooldownMs?: number;
}

const DEFAULTS = {
  threshold: 0.42,
  minGapMs: 120,
  maxGapMs: 900,
  cooldownMs: 2500,
};

export async function startClapDetector(
  onDoubleClap: () => void,
  opts: ClapDetectorOptions = {},
): Promise<ClapDetectorHandle | null> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;

  const threshold = opts.threshold ?? DEFAULTS.threshold;
  const minGapMs = opts.minGapMs ?? DEFAULTS.minGapMs;
  const maxGapMs = opts.maxGapMs ?? DEFAULTS.maxGapMs;
  const cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch {
    return null;
  }

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);

  const data = new Float32Array(analyser.fftSize);
  let lastClapAt = 0;
  let awaitingSecond = false;
  let lastFireAt = 0;
  let raf = 0;
  let armed = true;
  let wasAbove = false;

  const tick = () => {
    if (!armed) return;
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] ?? 0);
      if (v > peak) peak = v;
    }
    const above = peak >= threshold;
    const now = performance.now();

    if (above && !wasAbove) {
      // Borda de subida = candidata a palma.
      if (now - lastFireAt < cooldownMs) {
        wasAbove = above;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!awaitingSecond) {
        awaitingSecond = true;
        lastClapAt = now;
      } else {
        const gap = now - lastClapAt;
        if (gap >= minGapMs && gap <= maxGapMs) {
          awaitingSecond = false;
          lastFireAt = now;
          onDoubleClap();
        } else if (gap > maxGapMs) {
          // Reinicia a sequência com esta palma.
          lastClapAt = now;
        }
      }
    }
    if (awaitingSecond && now - lastClapAt > maxGapMs) {
      awaitingSecond = false;
    }
    wasAbove = above;
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
