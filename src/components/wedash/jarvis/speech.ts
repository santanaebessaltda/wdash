/** STT / TTS — OpenAI TTS (voz JARVIS) com fallback Web Speech. */

import { jarvisSpeak } from "./llmClient";

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

/**
 * Voz do JARVIS: OpenAI TTS (onyx) via Edge; se falhar, Web Speech.
 * Retorna cancelador síncrono (como antes).
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

  void (async () => {
    const remote = await jarvisSpeak(trimmed);
    if (cancelled) return;

    if (remote.ok) {
      try {
        const binary = Uint8Array.from(atob(remote.audioBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([binary], { type: remote.mime || "audio/mpeg" });
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
          if (cancelled) return;
          stopRemoteAudio();
          cancelBrowser = speakBrowser(trimmed, opts);
        };
        await audio.play();
        return;
      } catch {
        if (cancelled) return;
        stopRemoteAudio();
      }
    }

    if (cancelled) return;
    cancelBrowser = speakBrowser(trimmed, opts);
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
