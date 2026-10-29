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
import { searchForRoute } from "@/pages/dashboard/periodQuery";
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
import {
  createSpeechRecognition,
  speak,
  speechRecognitionSupported,
  stopSpeaking,
  ttsSupported,
  type SpeechRecognitionLike,
} from "./speech";

export type JarvisMessage = { from: "user" | "jarvis"; text: string };
export type JarvisMode = "idle" | "listening" | "thinking" | "speaking";
export type JarvisCreated =
  | { kind: "challenge" | "goal"; id: string; name: string }
  | { kind: "schedule"; name: string };

const OPENING: JarvisMessage = {
  from: "jarvis",
  text: "E aí. Sou o JARVIS. Manda no texto ou no botão de voz — a gente resolve junto, e eu só gravo depois que você autorizar.",
};

export const SUGGESTIONS = [
  "Como estão as vendas dos últimos 3 meses?",
  "Tem produto parado no estoque?",
  "Abre a Visão geral",
  "Quero montar um desafio",
  "Vamos criar a meta de novembro",
  "Gerar a escala de novembro",
];

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
  openVoice: () => void;
  closeVoice: () => void;
  /** Para a gravação e manda pro Whisper. */
  finishVoice: () => void;
  reply: (q: string) => void;
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

  const [messages, setMessages] = useState<JarvisMessage[]>([OPENING]);
  const [mode, setMode] = useState<JarvisMode>("idle");
  const [micHint, setMicHint] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [challengeDraft, setChallengeDraft] = useState<ChallengeDraft | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [createdItem, setCreatedItem] = useState<JarvisCreated | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const cancelSpeakRef = useRef<(() => void) | null>(null);
  const challengeDraftRef = useRef<ChallengeDraft | null>(null);
  const goalDraftRef = useRef<GoalDraft | null>(null);
  const scheduleDraftRef = useRef<ScheduleDraft | null>(null);
  const replyGen = useRef(0);
  const voiceOpenRef = useRef(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const vadRafRef = useRef(0);
  const startListeningRef = useRef<() => void>(() => undefined);
  const finishVoiceRef = useRef<() => void>(() => undefined);
  const messagesRef = useRef<JarvisMessage[]>([OPENING]);
  messagesRef.current = messages;

  challengeDraftRef.current = challengeDraft;
  goalDraftRef.current = goalDraft;
  scheduleDraftRef.current = scheduleDraft;
  voiceOpenRef.current = voiceOpen;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, mode, challengeDraft, goalDraft, scheduleDraft, createdItem]);

  const storeNameFor = useCallback(
    (storeId: string) => {
      if (!session) return "";
      return jarvisContextFromSession(session, readTopbarStoreIds()).stores.find((s) => s.id === storeId)?.tradeName ?? "";
    },
    [session],
  );

  const speakAnswer = useCallback((answer: string, opts?: { listenAfter?: boolean }) => {
    setMessages((m) => [...m, { from: "jarvis", text: answer }]);
    if (ttsSupported()) {
      setMode("speaking");
      cancelSpeakRef.current?.();
      cancelSpeakRef.current = speak(answer, {
        onEnd: () => {
          setMode((cur) => (cur === "speaking" ? "idle" : cur));
          if (opts?.listenAfter && voiceOpenRef.current) {
            window.setTimeout(() => startListeningRef.current(), 400);
          }
        },
      });
    } else {
      setMode("idle");
      if (opts?.listenAfter && voiceOpenRef.current) {
        window.setTimeout(() => startListeningRef.current(), 400);
      }
    }
  }, []);

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
          navigate({ pathname: target.to, search: searchForRoute(target.to, location.search) });
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

      const history: LlmChatMessage[] = messagesRef.current
        .filter((m) => m !== OPENING)
        .slice(-12)
        .map((m) => ({
          role: m.from === "user" ? "user" : "assistant",
          content: m.text,
        }));

      void (async () => {
        const llm = await jarvisLlmTurn(history, ctx, q);
        if (gen !== replyGen.current) return;

        if (!llm.ok) {
          if (llm.reason === "openai_not_configured") {
            setMicHint("IA ainda sem chave no servidor — usando modo local.");
          }
          await replyLocal(q, ctx, finish);
          return;
        }

        for (const effect of llm.sideEffects) {
          if (effect.kind === "navigate") {
            const target = resolveNavigate(effect.request, session.role);
            if (target) {
              navigate({ pathname: target.to, search: searchForRoute(target.to, location.search) });
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

        finish(llm.content);
      })();
    },
    [
      authorizeChallenge,
      authorizeGoal,
      authorizeSchedule,
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
  }, [stopVad]);

  const finishMediaRecording = useCallback(() => {
    const rec = mediaRecRef.current;
    if (!rec || rec.state === "inactive") return;
    stopVad();
    rec.onstop = () => {
      const chunks = mediaChunksRef.current;
      const mime = rec.mimeType || "audio/webm";
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      mediaRecRef.current = null;
      if (chunks.length === 0) {
        setMode("idle");
        setMicHint("Não peguei áudio. Fala um pouco mais alto e tenta de novo.");
        if (voiceOpenRef.current) window.setTimeout(() => startListeningRef.current(), 600);
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
          setDraftText(tr.text);
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

  const MIC_DENIED_HINT =
    "Microfone bloqueado. No Chrome: cadeado ao lado da URL → Configurações do site → Microfone → Permitir → recarrega a página.";

  /** Dispara o prompt nativo do navegador (getUserMedia). Sem isso o Web Speech só falha com not-allowed. */
  const ensureMicPermission = useCallback(async (): Promise<"granted" | "denied" | "unavailable"> => {
    if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
    try {
      // Se já foi concedido, resolve na hora. Se ainda não, o Chrome mostra o popup.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.getTracks().forEach((t) => t.stop());
      return "granted";
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        return "denied";
      }
      return "unavailable";
    }
  }, []);

  const startMediaWithVad = useCallback(
    async (existingStream?: MediaStream) => {
      if ((!navigator.mediaDevices?.getUserMedia && !existingStream) || typeof MediaRecorder === "undefined") {
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
          (await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          }));
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
        rec.start(200);
        setMode("listening");
        setMicHint("Pode falar — paro sozinho quando você silenciar.");

        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        let heardSpeech = false;
        let silentMs = 0;
        let lastTs = performance.now();
        const startedAt = performance.now();

        const tick = () => {
          if (!voiceOpenRef.current || mediaRecRef.current !== rec) {
            void ctx.close();
            return;
          }
          analyser.getFloatTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] ?? 0);
            if (v > peak) peak = v;
          }
          const now = performance.now();
          const dt = now - lastTs;
          lastTs = now;
          if (peak >= 0.04) {
            heardSpeech = true;
            silentMs = 0;
          } else if (heardSpeech) {
            silentMs += dt;
            if (silentMs >= 1100) {
              void ctx.close();
              finishVoiceRef.current();
              return;
            }
          }
          if (now - startedAt > 20_000) {
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
          name === "NotAllowedError" || name === "PermissionDeniedError" ? MIC_DENIED_HINT : "Não consegui abrir o microfone.",
        );
      }
    },
    [stopMediaTracks],
  );

  const startWebSpeech = useCallback(() => {
    const rec = createSpeechRecognition();
    if (!rec) {
      void startMediaWithVad();
      return;
    }
    try {
      speechRecRef.current?.abort();
    } catch {
      /* ignore */
    }
    stopSpeaking();
    setMicHint(null);
    setDraftText("");
    speechRecRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i];
        if (!row) continue;
        const piece = row[0]?.transcript ?? "";
        if (row.isFinal) finalText += piece;
        else interim += piece;
      }
      const shown = (finalText || interim).trim();
      if (shown) setDraftText(shown);
    };
    rec.onerror = (event) => {
      const err = event.error;
      if (err === "aborted") return;
      if (err === "no-speech") {
        setMicHint("Não ouvi nada — fala de novo.");
        setMode("idle");
        if (voiceOpenRef.current) window.setTimeout(() => startListeningRef.current(), 500);
        return;
      }
      // not-allowed / network / etc.: tenta gravação (já pedimos getUserMedia antes)
      void startMediaWithVad();
    };
    rec.onend = () => {
      speechRecRef.current = null;
      const said = finalText.trim();
      if (said) {
        setMode("thinking");
        reply(said);
        return;
      }
      if (voiceOpenRef.current) {
        setMode("idle");
      }
    };
    try {
      rec.start();
      setMode("listening");
      setMicHint("Pode falar — envio sozinho quando você parar.");
    } catch {
      void startMediaWithVad();
    }
  }, [reply, startMediaWithVad]);

  const startListening = useCallback(() => {
    if (!voiceOpenRef.current) return;
    void (async () => {
      setMicHint("Pedindo acesso ao microfone…");
      const perm = await ensureMicPermission();
      if (!voiceOpenRef.current) return;
      if (perm === "denied") {
        setMode("idle");
        setMicHint(MIC_DENIED_HINT);
        return;
      }
      if (perm === "unavailable") {
        setMode("idle");
        setMicHint("Sem microfone neste aparelho — usa o chat escrito.");
        return;
      }
      // Chrome/Edge: Web Speech ao vivo. Senão / se falhar: Whisper.
      if (speechRecognitionSupported()) startWebSpeech();
      else void startMediaWithVad();
    })();
  }, [ensureMicPermission, startMediaWithVad, startWebSpeech]);
  startListeningRef.current = () => startListening();

  const finishVoice = useCallback(() => {
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
    startListening();
  }, [finishMediaRecording, startListening]);
  finishVoiceRef.current = () => finishVoice();

  const openVoice = useCallback(() => {
    setVoiceOpen(true);
    stopSpeaking();
    setMicHint(null);
    setMode("idle");
    // Espera o detector de palmas soltar o mic
    window.setTimeout(() => startListening(), 450);
  }, [startListening]);

  const closeVoice = useCallback(() => {
    setVoiceOpen(false);
    stopMediaTracks();
    stopSpeaking();
    cancelSpeakRef.current?.();
    setDraftText("");
    setMode("idle");
  }, [stopMediaTracks]);

  useEffect(() => {
    return () => {
      cancelSpeakRef.current?.();
      stopSpeaking();
      stopMediaTracks();
    };
  }, [stopMediaTracks]);

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
      openVoice,
      closeVoice,
      finishVoice,
      reply,
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
      challengeDraft,
      closeVoice,
      commitBusy,
      createdItem,
      draftText,
      finishVoice,
      goalDraft,
      messages,
      micHint,
      mode,
      openVoice,
      reply,
      scheduleDraft,
      speakAnswer,
      storeNameFor,
      voiceOpen,
    ],
  );

  return <JarvisContext.Provider value={api}>{children}</JarvisContext.Provider>;
}
