import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { validateChallengeForm } from "@/data/wedash/challengeForm";
import { isOwner } from "@/layout/nav-wedash";
import { useSession } from "@/session/SessionProvider";
import { jarvisAnswer } from "./answer";
import { commitChallenge } from "./challengeCommit";
import {
  challengeDraftReady,
  discussChallenge,
  missingChallengeLabels,
  type ChallengeDraft,
} from "./challengeDraft";
import { jarvisContextFromSession } from "./context";
import { commitGoal } from "./goalCommit";
import {
  discussGoal,
  goalDraftReady,
  missingGoalLabels,
  validateGoalDraft,
  type GoalDraft,
} from "./goalDraft";
import { blobToBase64, jarvisLlmTurn, jarvisTranscribe, type LlmChatMessage } from "./llmClient";
import {
  formatNavigateReply,
  looksLikeNavigate,
  resolveNavigate,
} from "./navigateBrief";
import { classifyIntent } from "./respond";
import { commitSchedule } from "./scheduleCommit";
import {
  discussSchedule,
  missingScheduleLabels,
  scheduleDraftReady,
  validateScheduleDraft,
  type ScheduleDraft,
} from "./scheduleDraft";
import { firstNameFrom, voiceStandbyLine } from "./greeting";
import { loadSalesBrief } from "./salesBrief";
import {
  createSpeechRecognition,
  speak,
  speechRecognitionSupported,
  stopSpeaking,
  ttsSupported,
  warmJarvisTts,
  type SpeechRecognitionLike,
} from "./speech";
import { scrollAppMain } from "./pageChrome";
import { searchWithPeriodFromQuestion, syncScopePeriodFromQuestion } from "./syncPeriod";

const VOICE_READ_KEY = "wedash.jarvis.voiceRead";

function readStoredVoiceRead(): boolean {
  try {
    const v = localStorage.getItem(VOICE_READ_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

export type JarvisMessage = { from: "user" | "jarvis"; text: string };
export type JarvisMode = "idle" | "listening" | "thinking" | "speaking";
export type JarvisCreated =
  | { kind: "challenge" | "goal"; id: string; name: string }
  | { kind: "schedule"; name: string };

function readTopbarStoreIds(): string[] {
  try {
    const raw = sessionStorage.getItem("wedash.store") ?? sessionStorage.getItem("gestao.filial");
    if (!raw) return [];
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

type JarvisApi = {
  allowed: boolean;
  messages: JarvisMessage[];
  mode: JarvisMode;
  micHint: string | null;
  draftText: string;
  setDraftText: (v: string) => void;
  challengeDraft: ChallengeDraft | null;
  goalDraft: GoalDraft | null;
  scheduleDraft: ScheduleDraft | null;
  createdItem: JarvisCreated | null;
  commitBusy: boolean;
  voiceOpen: boolean;
  /** Tab/janela oculta: áudio pausado até "Retomar voz". */
  voicePaused: boolean;
  resumeVoice: () => void;
  /** Leitura em voz das respostas (TTS). Ligada/desligada. */
  voiceRead: boolean;
  toggleVoiceRead: () => void;
  /** Microfone → grava → Whisper no campo (UI REC estilo Néctar). */
  dictating: boolean;
  dictateBusy: boolean;
  dictateSeconds: number;
  dictateLevels: number[];
  /** Níveis do waveform no modo conversa por voz (OUVINDO…). */
  voiceLevels: number[];
  startDictate: () => void;
  finishDictate: () => void;
  cancelDictate: () => void;
  /** Clique no botão de onda → fala inicial + escuta no hub (estilo Néctar). */
  openVoice: (opts?: { source?: "button" | "clap" }) => void;
  closeVoice: () => void;
  /** Para a gravação / envia; em idle, pede mic de novo (precisa de clique). */
  finishVoice: () => void;
  reply: (q: string) => void;
  clearChat: () => void;
  authorizeChallenge: () => void;
  authorizeGoal: () => void;
  authorizeSchedule: () => void;
  discardChallenge: () => void;
  discardGoal: () => void;
  discardSchedule: () => void;
  storeNameFor: (storeId: string) => string;
  endRef: React.RefObject<HTMLDivElement | null>;
};

const JarvisContext = createContext<JarvisApi | null>(null);

export function useJarvis(): JarvisApi {
  const ctx = useContext(JarvisContext);
  if (!ctx) throw new Error("useJarvis fora do JarvisProvider");
  return ctx;
}

export function JarvisProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const allowed = Boolean(session && isOwner(session.role));

  const [messages, setMessages] = useState<JarvisMessage[]>([]);
  const [mode, setMode] = useState<JarvisMode>("idle");
  const [micHint, setMicHint] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [challengeDraft, setChallengeDraft] = useState<ChallengeDraft | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [createdItem, setCreatedItem] = useState<JarvisCreated | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [voiceRead, setVoiceRead] = useState(readStoredVoiceRead);
  const [dictating, setDictating] = useState(false);
  const [dictateBusy, setDictateBusy] = useState(false);
  const [dictateSeconds, setDictateSeconds] = useState(0);
  const [dictateLevels, setDictateLevels] = useState<number[]>(() => Array.from({ length: 40 }, () => 0.12));
  const [voiceLevels, setVoiceLevels] = useState<number[]>(() => Array.from({ length: 40 }, () => 0.12));

  const endRef = useRef<HTMLDivElement>(null);
  const cancelSpeakRef = useRef<(() => void) | null>(null);
  const challengeDraftRef = useRef<ChallengeDraft | null>(null);
  const goalDraftRef = useRef<GoalDraft | null>(null);
  const scheduleDraftRef = useRef<ScheduleDraft | null>(null);
  const replyGen = useRef(0);
  const voiceOpenRef = useRef(false);
  const voicePausedRef = useRef(false);
  const voiceReadRef = useRef(voiceRead);
  /** Sync no clique — evita palma abrir voz antes do re-render do `dictating`. */
  const dictatingRef = useRef(false);
  const dictateBusyRef = useRef(false);
  const dictateBaseRef = useRef("");
  const dictateRecRef = useRef<MediaRecorder | null>(null);
  const dictateStreamRef = useRef<MediaStream | null>(null);
  const dictateChunksRef = useRef<Blob[]>([]);
  const dictateDiscardRef = useRef(false);
  const dictateRafRef = useRef(0);
  const dictateTimerRef = useRef(0);
  const dictateAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const vadRafRef = useRef(0);
  const startListeningRef = useRef<() => void>(() => undefined);
  const finishVoiceRef = useRef<() => void>(() => undefined);
  const messagesRef = useRef<JarvisMessage[]>([]);
  messagesRef.current = messages;

  challengeDraftRef.current = challengeDraft;
  goalDraftRef.current = goalDraft;
  scheduleDraftRef.current = scheduleDraft;
  voiceOpenRef.current = voiceOpen;
  voicePausedRef.current = voicePaused;
  voiceReadRef.current = voiceRead;
  dictatingRef.current = dictating;
  dictateBusyRef.current = dictateBusy;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, mode, challengeDraft, goalDraft, scheduleDraft, createdItem]);

  /** Waveform sintético enquanto JARVIS fala / pensa (estilo Néctar). */
  useEffect(() => {
    if (!voiceOpen || voicePaused) return;
    if (mode !== "speaking" && mode !== "thinking") return;
    let raf = 0;
    let t = 0;
    const amp = mode === "speaking" ? 0.62 : 0.28;
    const tick = () => {
      t += mode === "speaking" ? 0.22 : 0.1;
      setVoiceLevels(
        Array.from({ length: 40 }, (_, i) => {
          const wave = 0.12 + amp * Math.abs(Math.sin(t + i * 0.38));
          return Math.min(1, wave);
        }),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, voiceOpen, voicePaused]);

  const storeNameFor = useCallback(
    (storeId: string) => {
      if (!session) return "";
      return jarvisContextFromSession(session, readTopbarStoreIds()).stores.find((s) => s.id === storeId)?.tradeName ?? "";
    },
    [session],
  );

  const speakAnswer = useCallback((answer: string, opts?: { listenAfter?: boolean }) => {
    const finish = () => {
      setMode((cur) => (cur === "speaking" ? "idle" : cur));
      if (opts?.listenAfter && voiceOpenRef.current && !voicePausedRef.current) {
        // Mic quente: escuta na hora que a fala acaba (sem pausa artificial).
        startListeningRef.current();
      }
    };
    // Modo voz sempre fala; no chat, só se "Leitura em voz" estiver ligada.
    // Tab oculta: não gasta TTS — só deixa o texto no chat.
    const shouldSpeak =
      !voicePausedRef.current && (voiceOpenRef.current || voiceReadRef.current);
    // Dispara TTS antes do setState — menos atraso texto→voz.
    if (shouldSpeak && ttsSupported()) {
      setMode("speaking");
      cancelSpeakRef.current?.();
      cancelSpeakRef.current = speak(answer, { onEnd: finish });
    } else {
      finish();
    }
    setMessages((m) => [...m, { from: "jarvis", text: answer }]);
  }, []);

  const toggleVoiceRead = useCallback(() => {
    setVoiceRead((prev) => {
      const next = !prev;
      voiceReadRef.current = next;
      try {
        localStorage.setItem(VOICE_READ_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) {
        cancelSpeakRef.current?.();
        stopSpeaking();
        setMode((cur) => (cur === "speaking" ? "idle" : cur));
      }
      return next;
    });
  }, []);

  const tearDownDictateHardware = useCallback(() => {
    if (dictateRafRef.current) cancelAnimationFrame(dictateRafRef.current);
    dictateRafRef.current = 0;
    if (dictateTimerRef.current) window.clearInterval(dictateTimerRef.current);
    dictateTimerRef.current = 0;
    try {
      if (dictateRecRef.current && dictateRecRef.current.state !== "inactive") {
        dictateRecRef.current.onstop = null;
        dictateRecRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    dictateRecRef.current = null;
    dictateStreamRef.current?.getTracks().forEach((t) => t.stop());
    dictateStreamRef.current = null;
    if (dictateAudioCtxRef.current) {
      void dictateAudioCtxRef.current.close().catch(() => undefined);
      dictateAudioCtxRef.current = null;
    }
    dictateChunksRef.current = [];
  }, []);

  const cancelDictate = useCallback(() => {
    dictateDiscardRef.current = true;
    dictatingRef.current = false;
    dictateBusyRef.current = false;
    tearDownDictateHardware();
    setDictating(false);
    setDictateBusy(false);
    setDictateSeconds(0);
    setDictateLevels(Array.from({ length: 40 }, () => 0.12));
    setMicHint(null);
  }, [tearDownDictateHardware]);

  const finishDictate = useCallback(() => {
    const rec = dictateRecRef.current;
    if (!rec || rec.state === "inactive") {
      cancelDictate();
      return;
    }
    dictateDiscardRef.current = false;
    dictateBusyRef.current = true;
    setDictateBusy(true);
    setMicHint("Transcrevendo…");
    if (dictateRafRef.current) cancelAnimationFrame(dictateRafRef.current);
    dictateRafRef.current = 0;
    if (dictateTimerRef.current) window.clearInterval(dictateTimerRef.current);
    dictateTimerRef.current = 0;

    rec.onstop = () => {
      const chunks = dictateChunksRef.current.slice();
      const mime = rec.mimeType || "audio/webm";
      dictateStreamRef.current?.getTracks().forEach((t) => t.stop());
      dictateStreamRef.current = null;
      dictateRecRef.current = null;
      if (dictateAudioCtxRef.current) {
        void dictateAudioCtxRef.current.close().catch(() => undefined);
        dictateAudioCtxRef.current = null;
      }
      dictateChunksRef.current = [];

      if (dictateDiscardRef.current) {
        setDictating(false);
        setDictateBusy(false);
        setDictateSeconds(0);
        setMicHint(null);
        return;
      }
      if (chunks.length === 0) {
        setDictating(false);
        setDictateBusy(false);
        setDictateSeconds(0);
        setMicHint("Não peguei áudio. Tenta de novo.");
        return;
      }

      const blob = new Blob(chunks, { type: mime });
      void (async () => {
        try {
          const b64 = await blobToBase64(blob);
          const tr = await jarvisTranscribe(b64, mime.split(";")[0] || mime);
          if (!tr.ok) {
            setDictating(false);
            setDictateBusy(false);
            setDictateSeconds(0);
            setMicHint(
              tr.reason === "openai_not_configured"
                ? "Whisper ainda sem chave no servidor."
                : "Não entendi o áudio. Tenta de novo.",
            );
            return;
          }
          const base = dictateBaseRef.current.trim();
          const next = base ? `${base} ${tr.text}`.trim() : tr.text.trim();
          setDraftText(next);
          setDictating(false);
          setDictateBusy(false);
          setDictateSeconds(0);
          setDictateLevels(Array.from({ length: 40 }, () => 0.12));
          setMicHint(null);
        } catch {
          setDictating(false);
          setDictateBusy(false);
          setDictateSeconds(0);
          setMicHint("Falhou ao transcrever. Tenta de novo.");
        }
      })();
    };

    try {
      rec.stop();
    } catch {
      cancelDictate();
    }
  }, [cancelDictate]);

  /**
   * Microfone do composer: grava no gesto do clique (pede permissão),
   * UI REC + waveform; ao parar, Whisper → texto no campo.
   * Marca `dictating` já no clique para o detector de palmas não abrir a sessão de voz.
   */
  const startDictate = useCallback(() => {
    if (dictating || dictateBusy || voiceOpenRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicHint("Sem microfone neste aparelho — digita no campo.");
      return;
    }

    stopSpeaking();
    cancelSpeakRef.current?.();
    dictateDiscardRef.current = false;
    dictateBaseRef.current = draftText;
    dictatingRef.current = true;
    dictateBusyRef.current = false;
    setDictating(true);
    setDictateBusy(false);
    setDictateSeconds(0);
    setDictateLevels(Array.from({ length: 40 }, () => 0.12));
    setMicHint(null);

    void navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      .then((stream) => {
        // Palmas / botão de onda podem ter aberto a voz enquanto o prompt pendia.
        if (voiceOpenRef.current || dictateDiscardRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          dictatingRef.current = false;
          setDictating(false);
          return;
        }

        dictateStreamRef.current = stream;
        dictateChunksRef.current = [];

        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        dictateRecRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) dictateChunksRef.current.push(ev.data);
        };
        try {
          rec.start(200);
        } catch {
          stream.getTracks().forEach((t) => t.stop());
          dictateStreamRef.current = null;
          dictateRecRef.current = null;
          dictatingRef.current = false;
          setDictating(false);
          setMicHint("Não consegui gravar o áudio.");
          return;
        }

        // Waveform ao vivo
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            dictateAudioCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.55;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              analyser.getByteFrequencyData(data);
              const bars = 40;
              const step = Math.max(1, Math.floor(data.length / bars));
              const next: number[] = [];
              for (let i = 0; i < bars; i++) {
                let sum = 0;
                for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
                next.push(Math.min(1, sum / step / 180));
              }
              setDictateLevels(next);
              dictateRafRef.current = requestAnimationFrame(tick);
            };
            if (ctx.state === "suspended") void ctx.resume();
            dictateRafRef.current = requestAnimationFrame(tick);
          }
        } catch {
          /* waveform opcional */
        }

        dictateTimerRef.current = window.setInterval(() => {
          setDictateSeconds((s) => s + 1);
        }, 1000);

        setMicHint(null);
      })
      .catch((err) => {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          setMicHint("Microfone bloqueado neste site. Libera no cadeado da URL e tenta de novo.");
        } else {
          setMicHint("Não consegui abrir o microfone.");
        }
        dictatingRef.current = false;
        dictateBusyRef.current = false;
        setDictating(false);
        setDictateBusy(false);
      });
  }, [dictateBusy, dictating, draftText]);

  const authorizeChallenge = useCallback(async () => {
    if (!session || !challengeDraftRef.current || commitBusy) return;
    const draft = challengeDraftRef.current;
    if (!challengeDraftReady(draft.form)) {
      speakAnswer(`Ainda falta ${missingChallengeLabels(validateChallengeForm(draft.form)).join(", ")}.`, {
        listenAfter: voiceOpenRef.current,
      });
      return;
    }
    setCommitBusy(true);
    setMode("thinking");
    const res = await commitChallenge(session.tenantId, draft.form);
    setCommitBusy(false);
    if (!res.ok) {
      speakAnswer(res.reason, { listenAfter: voiceOpenRef.current });
      return;
    }
    setChallengeDraft(null);
    challengeDraftRef.current = null;
    setCreatedItem({ kind: "challenge", id: res.id, name: res.name });
    speakAnswer(`Fechado — desafio “${res.name}” criado. Tem o link aí embaixo.`, {
      listenAfter: voiceOpenRef.current,
    });
  }, [commitBusy, session, speakAnswer]);

  const authorizeGoal = useCallback(async () => {
    if (!session || !goalDraftRef.current || commitBusy) return;
    const draft = goalDraftRef.current;
    if (!goalDraftReady(draft.form)) {
      speakAnswer(`Ainda falta ${missingGoalLabels(validateGoalDraft(draft.form)).join(", ")}.`, {
        listenAfter: voiceOpenRef.current,
      });
      return;
    }
    setCommitBusy(true);
    setMode("thinking");
    const res = await commitGoal(session.tenantId, draft.form);
    setCommitBusy(false);
    if (!res.ok) {
      speakAnswer(res.reason, { listenAfter: voiceOpenRef.current });
      return;
    }
    setGoalDraft(null);
    goalDraftRef.current = null;
    setCreatedItem({ kind: "goal", id: res.id, name: res.name });
    speakAnswer(`Fechado — meta “${res.name}” criada. Link embaixo.`, { listenAfter: voiceOpenRef.current });
  }, [commitBusy, session, speakAnswer]);

  const authorizeSchedule = useCallback(async () => {
    if (!session || !scheduleDraftRef.current || commitBusy) return;
    const draft = scheduleDraftRef.current;
    if (!scheduleDraftReady(draft.form)) {
      speakAnswer(`Ainda falta ${missingScheduleLabels(validateScheduleDraft(draft.form)).join(", ")}.`, {
        listenAfter: voiceOpenRef.current,
      });
      return;
    }
    setCommitBusy(true);
    setMode("thinking");
    const res = await commitSchedule(session.tenantId, draft.form);
    setCommitBusy(false);
    if (!res.ok) {
      speakAnswer(res.reason, { listenAfter: voiceOpenRef.current });
      return;
    }
    setScheduleDraft(null);
    scheduleDraftRef.current = null;
    const monthNames = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    const label = `${monthNames[Number(res.monthStart.slice(5, 7)) - 1]} de ${res.monthStart.slice(0, 4)}`;
    setCreatedItem({ kind: "schedule", name: label });
    const keepNote =
      res.keptManualDays > 0
        ? ` Mantive ${res.keptManualDays} dia${res.keptManualDays === 1 ? "" : "s"} que você tinha ajustado na mão.`
        : "";
    speakAnswer(
      `Pronto — escala de ${label} gerada pra ${res.people} pessoa${res.people === 1 ? "" : "s"}.${keepNote}`,
      { listenAfter: voiceOpenRef.current },
    );
  }, [commitBusy, session, speakAnswer]);

  const replyLocal = useCallback(
    async (q: string, ctx: ReturnType<typeof jarvisContextFromSession>, finish: (a: string) => void) => {
      const intent = classifyIntent(q);
      const n = q
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");

      if (intent === "navigate" || looksLikeNavigate(q)) {
        const target = resolveNavigate(q, session!.role);
        if (target) {
          syncScopePeriodFromQuestion(q, location.pathname, location.search, navigate);
          navigate({
            pathname: target.to,
            search: searchWithPeriodFromQuestion(target.to, location.search, q),
          });
          window.setTimeout(() => scrollAppMain({ top: 0 }), 40);
          finish(formatNavigateReply(target));
          return;
        }
        if (!/desafio|meta|escala|comissao|premiacao/.test(n)) {
          finish("Não achei essa tela. Tenta tipo: abre Visão geral, vai pro Financeiro, abre Escala…");
          return;
        }
      }

      if (
        intent === "challenge" ||
        (challengeDraftRef.current && intent === "unknown" && !goalDraftRef.current && !scheduleDraftRef.current)
      ) {
        setGoalDraft(null);
        goalDraftRef.current = null;
        setScheduleDraft(null);
        scheduleDraftRef.current = null;
        const { reply: answer, draft } = await discussChallenge(q, ctx, challengeDraftRef.current);
        setChallengeDraft(draft);
        challengeDraftRef.current = draft;
        setCreatedItem(null);
        finish(answer);
        return;
      }

      if (
        intent === "goal" ||
        (goalDraftRef.current && intent === "unknown" && !challengeDraftRef.current && !scheduleDraftRef.current)
      ) {
        setChallengeDraft(null);
        challengeDraftRef.current = null;
        setScheduleDraft(null);
        scheduleDraftRef.current = null;
        const { reply: answer, draft } = await discussGoal(q, ctx, goalDraftRef.current);
        setGoalDraft(draft);
        goalDraftRef.current = draft;
        setCreatedItem(null);
        finish(answer);
        return;
      }

      if (
        intent === "schedule" ||
        (scheduleDraftRef.current && intent === "unknown" && !challengeDraftRef.current && !goalDraftRef.current)
      ) {
        setChallengeDraft(null);
        challengeDraftRef.current = null;
        setGoalDraft(null);
        goalDraftRef.current = null;
        const { reply: answer, draft } = await discussSchedule(q, ctx, scheduleDraftRef.current);
        setScheduleDraft(draft);
        scheduleDraftRef.current = draft;
        setCreatedItem(null);
        finish(answer);
        return;
      }

      finish(await jarvisAnswer(q, ctx));
    },
    [location.search, navigate, session],
  );

  const reply = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || !session || !isOwner(session.role)) return;
      const gen = ++replyGen.current;
      const inVoice = voiceOpenRef.current;
      setMessages((m) => [...m, { from: "user", text: q }]);
      setDraftText("");
      setMode("thinking");
      setMicHint(null);
      stopSpeaking();
      const ctx = jarvisContextFromSession(session, readTopbarStoreIds());
      const n = q
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      const discardChallenge = /descart|cancela(r)? (o )?desafio|esquece (o )?desafio|nao quero (esse|o) desafio/.test(n);
      const discardGoal = /descart|cancela(r)? (a )?meta|esquece (a )?meta|nao quero (essa|a) meta/.test(n);
      const discardSchedule = /descart|cancela(r)? (a )?escala|esquece (a )?escala|nao quero (essa|a) escala/.test(n);

      const finish = (answer: string) => {
        if (gen !== replyGen.current) return;
        speakAnswer(answer, { listenAfter: inVoice });
      };

      if (discardChallenge && challengeDraftRef.current) {
        setChallengeDraft(null);
        challengeDraftRef.current = null;
        finish("Beleza, descartei o rascunho do desafio. Quando quiser a gente começa outro.");
        return;
      }
      if (discardGoal && goalDraftRef.current) {
        setGoalDraft(null);
        goalDraftRef.current = null;
        finish("Beleza, descartei a meta. Quando quiser montamos outra.");
        return;
      }
      if (discardSchedule && scheduleDraftRef.current) {
        setScheduleDraft(null);
        scheduleDraftRef.current = null;
        finish("Beleza, descartei a escala. É só pedir de novo.");
        return;
      }

      const intent = classifyIntent(q);
      if (intent === "authorize") {
        if (challengeDraftRef.current) {
          void authorizeChallenge();
          return;
        }
        if (goalDraftRef.current) {
          void authorizeGoal();
          return;
        }
        if (scheduleDraftRef.current) {
          void authorizeSchedule();
          return;
        }
        finish("Não tenho rascunho pendente. Manda um desafio, uma meta ou a escala que a gente monta.");
        return;
      }

      // Sempre tenta alinhar o período se a pergunta citar hoje/semana/mês (mesmo fora do fast-path).
      const applyPeriodAndScroll = () => {
        syncScopePeriodFromQuestion(q, location.pathname, location.search, navigate);
      };

      // Vendas: brief direto (sem round-trip LLM) + alinha o filtro de período da tela.
      if (intent === "analyze_sales") {
        applyPeriodAndScroll();
        void loadSalesBrief(ctx, q).then((answer) => {
          if (gen !== replyGen.current) return;
          finish(answer);
        });
        return;
      }

      const history: LlmChatMessage[] = messagesRef.current
        .slice(-12)
        .map((m) => ({
          role: m.from === "user" ? "user" : "assistant",
          content: m.text,
        }));

      void (async () => {
        const llm = await jarvisLlmTurn(history, ctx, q, { voiceMode: inVoice });
        if (gen !== replyGen.current) return;

        if (!llm.ok) {
          if (llm.reason === "openai_not_configured") {
            setMicHint("IA ainda sem chave no servidor — usando modo local.");
          }
          applyPeriodAndScroll();
          await replyLocal(q, ctx, finish);
          return;
        }

        for (const effect of llm.sideEffects) {
          if (effect.kind === "navigate") {
            const target = resolveNavigate(effect.request, session.role);
            if (target) {
              syncScopePeriodFromQuestion(q, location.pathname, location.search, navigate);
              navigate({
                pathname: target.to,
                search: searchWithPeriodFromQuestion(target.to, location.search, q),
              });
              window.setTimeout(() => scrollAppMain({ top: 0 }), 40);
            }
          } else if (effect.kind === "draft_challenge") {
            setGoalDraft(null);
            goalDraftRef.current = null;
            setScheduleDraft(null);
            scheduleDraftRef.current = null;
            const { draft } = await discussChallenge(effect.request || q, ctx, challengeDraftRef.current);
            if (gen !== replyGen.current) return;
            setChallengeDraft(draft);
            challengeDraftRef.current = draft;
            setCreatedItem(null);
          } else if (effect.kind === "draft_goal") {
            setChallengeDraft(null);
            challengeDraftRef.current = null;
            setScheduleDraft(null);
            scheduleDraftRef.current = null;
            const { draft } = await discussGoal(effect.request || q, ctx, goalDraftRef.current);
            if (gen !== replyGen.current) return;
            setGoalDraft(draft);
            goalDraftRef.current = draft;
            setCreatedItem(null);
          } else if (effect.kind === "draft_schedule") {
            setChallengeDraft(null);
            challengeDraftRef.current = null;
            setGoalDraft(null);
            goalDraftRef.current = null;
            const { draft } = await discussSchedule(effect.request || q, ctx, scheduleDraftRef.current);
            if (gen !== replyGen.current) return;
            setScheduleDraft(draft);
            scheduleDraftRef.current = draft;
            setCreatedItem(null);
          }
        }

        // Alinha filtro de período se a pergunta citar hoje/semana/mês (no-op se não citar).
        applyPeriodAndScroll();

        finish(llm.content);
      })();
    },
    [
      authorizeChallenge,
      authorizeGoal,
      authorizeSchedule,
      location.pathname,
      location.search,
      navigate,
      replyLocal,
      session,
      speakAnswer,
    ],
  );

  const stopVad = useCallback(() => {
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = 0;
  }, []);

  const stopMediaTracks = useCallback(() => {
    stopVad();
    try {
      speechRecRef.current?.abort();
    } catch {
      /* ignore */
    }
    speechRecRef.current = null;
    try {
      if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop();
    } catch {
      /* ignore */
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecRef.current = null;
    setVoiceLevels(Array.from({ length: 40 }, () => 0.12));
  }, [stopVad]);

  const liveMicStream = useCallback((): MediaStream | undefined => {
    const s = mediaStreamRef.current;
    if (!s) return undefined;
    const live = s.getTracks().some((t) => t.readyState === "live");
    return live ? s : undefined;
  }, []);

  const finishMediaRecording = useCallback(() => {
    const rec = mediaRecRef.current;
    if (!rec || rec.state === "inactive") return;
    stopVad();
    rec.onstop = () => {
      const chunks = mediaChunksRef.current;
      const mime = rec.mimeType || "audio/webm";
      // Mantém o mic aberto entre turnos (só para o recorder).
      mediaRecRef.current = null;
      if (chunks.length === 0) {
        setMode("idle");
        setMicHint("Não peguei áudio. Fala um pouco mais alto e tenta de novo.");
        if (voiceOpenRef.current && !voicePausedRef.current) {
          window.setTimeout(() => startListeningRef.current(), 120);
        }
        return;
      }
      const blob = new Blob(chunks, { type: mime });
      setMode("thinking");
      void (async () => {
        try {
          const b64 = await blobToBase64(blob);
          const tr = await jarvisTranscribe(b64, mime.split(";")[0] || mime);
          if (!tr.ok) {
            setMode("idle");
            setMicHint(
              tr.reason === "openai_not_configured"
                ? "Whisper ainda sem chave no servidor."
                : `Não entendi o áudio (${tr.reason}). Toca em Falar de novo.`,
            );
            return;
          }
          setDraftText("");
          reply(tr.text);
        } catch {
          setMode("idle");
          setMicHint("Falhou ao enviar o áudio. Tenta de novo.");
        }
      })();
    };
    try {
      rec.stop();
    } catch {
      stopMediaTracks();
      setMode("idle");
    }
  }, [reply, stopMediaTracks, stopVad]);

  const MIC_NEED_CLICK_HINT =
    "Toque em Falar para o Chrome pedir o microfone (só aparece depois de um clique).";

  const micAudioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  /** true se o site já tem mic liberado (sem precisar de popup). */
  const micAlreadyGranted = useCallback(async (): Promise<boolean> => {
    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
      return status.state === "granted";
    } catch {
      return false;
    }
  }, []);

  const startMediaWithVadRef = useRef<(s?: MediaStream) => void>(() => undefined);

  const attachVoiceLevels = useCallback((stream: MediaStream, active: () => boolean) => {
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!active()) {
          void ctx.close();
          return;
        }
        analyser.getByteFrequencyData(freqData);
        const bars = 40;
        const step = Math.max(1, Math.floor(freqData.length / bars));
        const next: number[] = [];
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += freqData[i * step + j] ?? 0;
          next.push(Math.min(1, sum / step / 150));
        }
        setVoiceLevels(next);
        vadRafRef.current = requestAnimationFrame(tick);
      };
      if (ctx.state === "suspended") void ctx.resume();
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* waveform opcional */
    }
  }, []);

  /** Conversa por voz: Web Speech (local, rápido). Fallback Whisper se falhar. */
  const startWebSpeechListen = useCallback(() => {
    if (voicePausedRef.current || !voiceOpenRef.current) return;
    const rec = createSpeechRecognition();
    if (!rec) {
      void startMediaWithVadRef.current();
      return;
    }
    try {
      speechRecRef.current?.abort();
    } catch {
      /* ignore */
    }
    stopVad();
    stopSpeaking();
    setMicHint(null);
    setDraftText("");
    speechRecRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    let gotResult = false;

    // Waveform com mic já aberto (ou pede um stream leve).
    void (async () => {
      try {
        const stream =
          liveMicStream() ??
          (await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          }));
        if (!voiceOpenRef.current || voicePausedRef.current) {
          if (!liveMicStream()) stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        attachVoiceLevels(stream, () => speechRecRef.current === rec && voiceOpenRef.current);
      } catch {
        /* sem waveform */
      }
    })();

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i];
        if (!row) continue;
        const piece = row[0]?.transcript ?? "";
        if (row.isFinal) {
          finalText += piece;
          gotResult = true;
        } else interim += piece;
      }
      const shown = (finalText || interim).trim();
      if (shown) setDraftText(shown);
    };
    rec.onerror = (event) => {
      const err = event.error;
      if (err === "aborted") return;
      speechRecRef.current = null;
      if (err === "no-speech") {
        setMode("idle");
        if (voiceOpenRef.current && !voicePausedRef.current) {
          window.setTimeout(() => startListeningRef.current(), 80);
        }
        return;
      }
      // Chrome sem STT estável → Whisper
      void startMediaWithVadRef.current(liveMicStream());
    };
    rec.onend = () => {
      if (speechRecRef.current !== rec) return;
      speechRecRef.current = null;
      stopVad();
      const said = finalText.trim();
      if (said) {
        setDraftText("");
        setMode("thinking");
        reply(said);
        return;
      }
      if (!gotResult && voiceOpenRef.current && !voicePausedRef.current) {
        setMode("idle");
      }
    };
    try {
      rec.start();
      setMode("listening");
    } catch {
      void startMediaWithVadRef.current(liveMicStream());
    }
  }, [attachVoiceLevels, liveMicStream, reply, stopVad]);

  const startMediaWithVad = useCallback(
    async (existingStream?: MediaStream) => {
      if (voicePausedRef.current) return;
      if ((!navigator.mediaDevices?.getUserMedia && !existingStream && !liveMicStream()) || typeof MediaRecorder === "undefined") {
        setMicHint("Sem microfone neste aparelho — usa o chat escrito.");
        setMode("idle");
        return;
      }
      try {
        stopSpeaking();
        setMicHint(null);
        setDraftText("");
        const stream =
          existingStream ??
          liveMicStream() ??
          (await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          }));
        if (voicePausedRef.current || !voiceOpenRef.current) {
          if (stream !== mediaStreamRef.current) stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        mediaChunksRef.current = [];
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/mp4")
              ? "audio/mp4"
              : "";
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mediaRecRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) mediaChunksRef.current.push(ev.data);
        };
        rec.onerror = () => {
          stopMediaTracks();
          setMode("idle");
          setMicHint("Falhou a gravação. Tenta de novo.");
        };
        rec.start(80);
        setMode("listening");
        setMicHint(null);

        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        const timeData = new Float32Array(analyser.fftSize);
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        let heardSpeech = false;
        let silentMs = 0;
        let lastTs = performance.now();
        const startedAt = performance.now();

        const tick = () => {
          if (!voiceOpenRef.current || voicePausedRef.current || mediaRecRef.current !== rec) {
            void ctx.close();
            return;
          }
          analyser.getFloatTimeDomainData(timeData);
          let peak = 0;
          for (let i = 0; i < timeData.length; i++) {
            const v = Math.abs(timeData[i] ?? 0);
            if (v > peak) peak = v;
          }
          analyser.getByteFrequencyData(freqData);
          const bars = 40;
          const step = Math.max(1, Math.floor(freqData.length / bars));
          const next: number[] = [];
          for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) sum += freqData[i * step + j] ?? 0;
            next.push(Math.min(1, sum / step / 150));
          }
          setVoiceLevels(next);

          const now = performance.now();
          const dt = now - lastTs;
          lastTs = now;
          if (peak >= 0.03) {
            heardSpeech = true;
            silentMs = 0;
          } else if (heardSpeech) {
            silentMs += dt;
            // ~0,42s de silêncio → envia (conversa mais ágil).
            if (silentMs >= 420) {
              void ctx.close();
              finishVoiceRef.current();
              return;
            }
          }
          if (now - startedAt > 16_000) {
            void ctx.close();
            finishVoiceRef.current();
            return;
          }
          vadRafRef.current = requestAnimationFrame(tick);
        };
        if (ctx.state === "suspended") void ctx.resume();
        vadRafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        stopMediaTracks();
        setMode("idle");
        const name = err instanceof DOMException ? err.name : "";
        setMicHint(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? null
            : "Não consegui abrir o microfone.",
        );
      }
    },
    [liveMicStream, stopMediaTracks],
  );
  startMediaWithVadRef.current = (s?: MediaStream) => {
    void startMediaWithVad(s);
  };

  /** Já com mic liberado: Web Speech (rápido) ou Whisper. */
  const beginListenAfterMicOk = useCallback(() => {
    if (!voiceOpenRef.current || voicePausedRef.current) return;
    if (speechRecognitionSupported()) startWebSpeechListen();
    else void startMediaWithVad(liveMicStream());
  }, [liveMicStream, startMediaWithVad, startWebSpeechListen]);

  const pauseVoiceSession = useCallback(() => {
    if (!voiceOpenRef.current || voicePausedRef.current) return;
    voicePausedRef.current = true;
    setVoicePaused(true);
    cancelSpeakRef.current?.();
    stopSpeaking();
    stopMediaTracks();
    setMode("idle");
    setMicHint(null);
    setVoiceLevels(Array.from({ length: 40 }, () => 0.08));
  }, [stopMediaTracks]);

  /** Clique em "Retomar voz" (gesto → mic de novo). */
  const resumeVoice = useCallback(() => {
    if (!voiceOpenRef.current) return;
    voicePausedRef.current = false;
    setVoicePaused(false);
    setMicHint(null);
    beginListenAfterMicOk();
  }, [beginListenAfterMicOk]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && voiceOpenRef.current) {
        pauseVoiceSession();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pauseVoiceSession]);

  /**
   * Clique no botão de onda: pede mic no gesto → fala inicial → escuta.
   */
  const requestMicFromUserGesture = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMode("idle");
      setMicHint("Sem microfone neste aparelho — usa o chat escrito.");
      return;
    }
    setMicHint(null);
    void navigator.mediaDevices
      .getUserMedia({ audio: micAudioConstraints })
      .then((stream) => {
        if (!voiceOpenRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const line = voiceStandbyLine(firstNameFrom(session?.name ?? ""));
        setMessages((m) => [...m, { from: "jarvis", text: line }]);
        setMode("speaking");
        cancelSpeakRef.current?.();
        cancelSpeakRef.current = speak(line, {
          onEnd: () => {
            if (!voiceOpenRef.current) {
              stream.getTracks().forEach((t) => t.stop());
              mediaStreamRef.current = null;
              setMode("idle");
              return;
            }
            beginListenAfterMicOk();
          },
        });
      })
      .catch((err) => {
        setVoiceOpen(false);
        setMode("idle");
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          setMicHint("Microfone bloqueado neste site. Libera no cadeado da URL e tenta de novo.");
        } else {
          setMicHint("Não consegui abrir o microfone. Tenta de novo.");
        }
      });
  }, [beginListenAfterMicOk, session?.name]);

  const startListening = useCallback(() => {
    if (!voiceOpenRef.current || voicePausedRef.current) return;
    // Reinício após TTS / silêncio: só se já tiver permissão (sem gesto).
    void (async () => {
      if (await micAlreadyGranted()) {
        beginListenAfterMicOk();
        return;
      }
      setMode("idle");
      setMicHint(MIC_NEED_CLICK_HINT);
    })();
  }, [beginListenAfterMicOk, micAlreadyGranted]);
  startListeningRef.current = () => startListening();

  const finishVoice = useCallback(() => {
    if (voicePausedRef.current) return;
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      finishMediaRecording();
      return;
    }
    // Idle no modo voz: volta a ouvir (sem repetir a fala inicial).
    beginListenAfterMicOk();
  }, [beginListenAfterMicOk, finishMediaRecording]);
  finishVoiceRef.current = () => finishVoice();

  const openVoice = useCallback(
    (opts?: { source?: "button" | "clap" }) => {
      const source = opts?.source ?? "button";
      // Palma não rouba o ditado (pop do getUserMedia / fala gerava falso positivo).
      if (source === "clap" && (dictatingRef.current || dictateBusyRef.current)) return;

      cancelDictate();
      voicePausedRef.current = false;
      setVoicePaused(false);
      setVoiceOpen(true);
      stopSpeaking();
      setDraftText("");
      setMode("idle");

      if (source === "clap") {
        // Palmas não contam como gesto: sem permissão prévia o Chrome não pergunta.
        void (async () => {
          if (await micAlreadyGranted()) {
            warmJarvisTts();
            // Mesma saudação do botão (mic já liberado).
            window.setTimeout(() => requestMicFromUserGesture(), 200);
            return;
          }
          setMicHint(MIC_NEED_CLICK_HINT);
        })();
        return;
      }

      // Clique no botão de voz: pedir mic AGORA (mesmo gesto).
      warmJarvisTts();
      requestMicFromUserGesture();
    },
    [cancelDictate, micAlreadyGranted, requestMicFromUserGesture],
  );

  const closeVoice = useCallback(() => {
    voicePausedRef.current = false;
    setVoicePaused(false);
    setVoiceOpen(false);
    stopMediaTracks();
    stopSpeaking();
    cancelSpeakRef.current?.();
    setDraftText("");
    setMicHint(null);
    setMode("idle");
    setVoiceLevels(Array.from({ length: 40 }, () => 0.12));
  }, [stopMediaTracks]);

  const clearChat = useCallback(() => {
    replyGen.current += 1;
    cancelSpeakRef.current?.();
    stopSpeaking();
    stopMediaTracks();
    cancelDictate();
    voicePausedRef.current = false;
    setVoicePaused(false);
    setVoiceOpen(false);
    setMessages([]);
    setDraftText("");
    setMicHint(null);
    setMode("idle");
    setChallengeDraft(null);
    challengeDraftRef.current = null;
    setGoalDraft(null);
    goalDraftRef.current = null;
    setScheduleDraft(null);
    scheduleDraftRef.current = null;
    setCreatedItem(null);
    setCommitBusy(false);
  }, [cancelDictate, stopMediaTracks]);

  useEffect(() => {
    return () => {
      cancelSpeakRef.current?.();
      stopSpeaking();
      stopMediaTracks();
      cancelDictate();
    };
  }, [cancelDictate, stopMediaTracks]);

  const api = useMemo<JarvisApi>(
    () => ({
      allowed,
      messages,
      mode,
      micHint,
      draftText,
      setDraftText,
      challengeDraft,
      goalDraft,
      scheduleDraft,
      createdItem,
      commitBusy,
      voiceOpen,
      voicePaused,
      resumeVoice,
      voiceRead,
      toggleVoiceRead,
      dictating,
      dictateBusy,
      dictateSeconds,
      dictateLevels,
      voiceLevels,
      startDictate,
      finishDictate,
      cancelDictate,
      openVoice,
      closeVoice,
      finishVoice,
      reply,
      clearChat,
      authorizeChallenge: () => void authorizeChallenge(),
      authorizeGoal: () => void authorizeGoal(),
      authorizeSchedule: () => void authorizeSchedule(),
      discardChallenge: () => {
        setChallengeDraft(null);
        challengeDraftRef.current = null;
        speakAnswer("Beleza, descartei o desafio.");
      },
      discardGoal: () => {
        setGoalDraft(null);
        goalDraftRef.current = null;
        speakAnswer("Beleza, descartei a meta.");
      },
      discardSchedule: () => {
        setScheduleDraft(null);
        scheduleDraftRef.current = null;
        speakAnswer("Beleza, descartei a escala.");
      },
      storeNameFor,
      endRef,
    }),
    [
      allowed,
      authorizeChallenge,
      authorizeGoal,
      authorizeSchedule,
      cancelDictate,
      challengeDraft,
      clearChat,
      closeVoice,
      commitBusy,
      createdItem,
      dictateBusy,
      dictateLevels,
      dictateSeconds,
      dictating,
      draftText,
      finishDictate,
      finishVoice,
      goalDraft,
      messages,
      micHint,
      mode,
      openVoice,
      reply,
      resumeVoice,
      scheduleDraft,
      speakAnswer,
      startDictate,
      storeNameFor,
      toggleVoiceRead,
      voiceLevels,
      voiceOpen,
      voicePaused,
      voiceRead,
    ],
  );

  return <JarvisContext.Provider value={api}>{children}</JarvisContext.Provider>;
}
