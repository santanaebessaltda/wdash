/** STT / TTS — Gemini TTS (voz JARVIS fixa) com fallback Web Speech. */

import { jarvisSpeak } from "./llmClient";
import { forSpeech } from "./speakablePt";

/** Cache de falas curtas (saudação) — mesma voz, sem novo round-trip. */
const ttsCache = new Map<string, { audioBase64: string; mime: string }>();
const TTS_CACHE_MAX_CHARS = 96;

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
  return typeof window !== "undefined" && ("speechSynthesis" in window || typeof Audio !== "undefined");
}

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;

function stopBrowserTts(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function stopRemoteAudio(): void {
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

/** Fallback: fala nativa do Chrome em pt-BR. */
function speakBrowser(text: string, opts?: { onEnd?: () => void }): () => void {
  if (!("speechSynthesis" in window)) {
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

function playRemoteAudio(
  audioBase64: string,
  mime: string,
  opts?: { onEnd?: () => void },
): void {
  const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([binary], { type: mime || "audio/wav" });
  const url = URL.createObjectURL(blob);
  activeObjectUrl = url;
  const audio = new Audio(url);
  activeAudio = audio;
  audio.onended = () => {
    if (activeAudio === audio) {
      stopRemoteAudio();
      opts?.onEnd?.();
    }
  };
  audio.onerror = () => {
    stopRemoteAudio();
    opts?.onEnd?.();
  };
  void audio.play().catch(() => {
    stopRemoteAudio();
    opts?.onEnd?.();
  });
}

/** Aquece a Edge TTS (TLS + frio) sem tocar áudio — chama no openVoice. */
export function warmJarvisTts(): void {
  void jarvisSpeak(".").then((r) => {
    if (r.ok && r.audioBase64.length < 8) return;
    /* só esquenta a conexão */
  });
}

/**
 * Voz do JARVIS: OpenAI TTS via Edge (cedar, masculina; mais rápido que Gemini).
 * Cache em falas curtas; 1 retry; Web Speech só se a Edge falhar de vez.
 */
export function speak(text: string, opts?: { onEnd?: () => void }): () => void {
  let cancelled = false;
  let cancelBrowser: (() => void) | null = null;

  stopRemoteAudio();
  stopBrowserTts();

  const trimmed = text.trim();
  if (!trimmed) {
    opts?.onEnd?.();
    return () => undefined;
  }
  const spoken = forSpeech(trimmed);

  void (async () => {
    const hit = ttsCache.get(spoken);
    if (hit) {
      if (cancelled) return;
      playRemoteAudio(hit.audioBase64, hit.mime, opts);
      return;
    }

    let remote = await jarvisSpeak(spoken);
    if (!remote.ok && !cancelled) {
      await new Promise((r) => setTimeout(r, 80));
      if (!cancelled) remote = await jarvisSpeak(spoken);
    }
    if (cancelled) return;

    if (remote.ok) {
      if (spoken.length <= TTS_CACHE_MAX_CHARS) {
        ttsCache.set(spoken, { audioBase64: remote.audioBase64, mime: remote.mime });
      }
      playRemoteAudio(remote.audioBase64, remote.mime, opts);
      return;
    }

    if (cancelled) return;
    cancelBrowser = speakBrowser(spoken, opts);
  })();

  return () => {
    cancelled = true;
    stopRemoteAudio();
    cancelBrowser?.();
    stopBrowserTts();
  };
}

export function stopSpeaking(): void {
  stopRemoteAudio();
  stopBrowserTts();
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
