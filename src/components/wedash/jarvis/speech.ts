/** STT / TTS via Web Speech API (Chromium/Android PWA; iOS limitado). */

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function speechRecognitionSupported(): boolean {
  return Boolean(speechRecognitionCtor());
}

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "pt-BR";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Fala em pt-BR; cancela fala anterior. */
export function speak(text: string, opts?: { onEnd?: () => void }): () => void {
  if (!ttsSupported()) {
    opts?.onEnd?.();
    return () => undefined;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR";
  u.rate = 1.05;
  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const pt =
      voices.find((v) => /pt-BR/i.test(v.lang) && /neural|google|microsoft|premium/i.test(v.name)) ??
      voices.find((v) => /pt-BR/i.test(v.lang)) ??
      voices.find((v) => /^pt/i.test(v.lang));
    if (pt) u.voice = pt;
  };
  pickVoice();
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      pickVoice();
      window.speechSynthesis.onvoiceschanged = null;
    };
  }
  u.onend = () => opts?.onEnd?.();
  u.onerror = () => opts?.onEnd?.();
  window.speechSynthesis.speak(u);
  return () => {
    window.speechSynthesis.cancel();
  };
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/** Normaliza texto para comparar wake word. */
export function normalizeWakeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WAKE_PATTERNS = [/\bei\s+jarvis\b/, /\bjarvis\b/, /\bol[aá]\s+jarvis\b/, /\bhey\s+jarvis\b/];

export function containsWakeWord(text: string): boolean {
  const n = normalizeWakeText(text);
  return WAKE_PATTERNS.some((re) => re.test(n));
}

/** Remove a wake word do início do comando, se houver. */
export function stripWakeWord(text: string): string {
  const n = normalizeWakeText(text);
  const cleaned = n
    .replace(/^(ei|ola|ol[aá]|hey)\s+jarvis\b[,.]?\s*/i, "")
    .replace(/^jarvis\b[,.]?\s*/i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : text.trim();
}
