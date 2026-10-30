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
import { splitJarvisReply, sleepMs, typingDelayMs } from "./chatBlocks";
import { commitGoal } from "./goalCommit";
import {
  discussGoal,
  formatGoalFactsForModel,
  goalCanCommit,
  looksLikeLeakedGoalFacts,
  missingGoalLabels,
  naturalGoalAskFromDraft,
  validateGoalDraft,
  type GoalDraft,
} from "./goalDraft";
import {
  blobToBase64,
  jarvisLlmTurn,
  jarvisTranscribe,
  type JarvisLlmHooks,
  type JarvisLlmSession,
  type LlmChatMessage,
} from "./llmClient";
import {
  classifyIntent,
  looksLikeLeaveChatRequest,
  STAY_IN_CHAT_REPLY,
} from "./respond";
import { commitSchedule } from "./scheduleCommit";
import {
  discussSchedule,
  missingScheduleLabels,
  scheduleDraftReady,
  validateScheduleDraft,
  type ScheduleDraft,
} from "./scheduleDraft";
import { syncScopePeriodFromQuestion } from "./syncPeriod";

export type JarvisMessage = { from: "user" | "jarvis"; text: string };
export type JarvisMode = "idle" | "thinking";
export type JarvisCreated =
  | { kind: "challenge"; id: string; name: string }
  | { kind: "goal"; id: string; name: string; asDraft?: boolean }
  | { kind: "schedule"; name: string };

const CHAT_HISTORY_KEY = "wedash.jarvis.chat";
const CHAT_HISTORY_MAX = 40;

function readTopbarStoreIds(): string[] {
  try {
    const raw = sessionStorage.getItem("wedash.store") ?? sessionStorage.getItem("gestao.filial");
    if (!raw) return [];
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function loadChatHistory(): JarvisMessage[] {
  try {
    const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is JarvisMessage =>
          Boolean(m) &&
          typeof m === "object" &&
          (m as JarvisMessage).from !== undefined &&
          ((m as JarvisMessage).from === "user" || (m as JarvisMessage).from === "jarvis") &&
          typeof (m as JarvisMessage).text === "string" &&
          (m as JarvisMessage).text.trim().length > 0,
      )
      .slice(-CHAT_HISTORY_MAX);
  } catch {
    return [];
  }
}

function persistChatHistory(messages: JarvisMessage[]) {
  try {
    sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-CHAT_HISTORY_MAX)));
  } catch {
    /* quota / private mode */
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
  /** Microfone → grava → Whisper no campo (UI REC estilo Néctar). */
  dictating: boolean;
  dictateBusy: boolean;
  dictateSeconds: number;
  dictateLevels: number[];
  startDictate: () => void;
  finishDictate: () => void;
  cancelDictate: () => void;
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

  const [messages, setMessages] = useState<JarvisMessage[]>(() => loadChatHistory());
  const [mode, setMode] = useState<JarvisMode>("idle");
  const [micHint, setMicHint] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [challengeDraft, setChallengeDraft] = useState<ChallengeDraft | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [createdItem, setCreatedItem] = useState<JarvisCreated | null>(null);
  const [dictating, setDictating] = useState(false);
  const [dictateBusy, setDictateBusy] = useState(false);
  const [dictateSeconds, setDictateSeconds] = useState(0);
  const [dictateLevels, setDictateLevels] = useState<number[]>(() => Array.from({ length: 40 }, () => 0.12));

  const endRef = useRef<HTMLDivElement>(null);
  const challengeDraftRef = useRef<ChallengeDraft | null>(null);
  const goalDraftRef = useRef<GoalDraft | null>(null);
  const scheduleDraftRef = useRef<ScheduleDraft | null>(null);
  const replyGen = useRef(0);
  const dictateBaseRef = useRef("");
  const dictateRecRef = useRef<MediaRecorder | null>(null);
  const dictateStreamRef = useRef<MediaStream | null>(null);
  const dictateChunksRef = useRef<Blob[]>([]);
  const dictateDiscardRef = useRef(false);
  const dictateRafRef = useRef(0);
  const dictateTimerRef = useRef(0);
  const dictateAudioCtxRef = useRef<AudioContext | null>(null);
  const messagesRef = useRef<JarvisMessage[]>(messages);
  messagesRef.current = messages;

  challengeDraftRef.current = challengeDraft;
  goalDraftRef.current = goalDraft;
  scheduleDraftRef.current = scheduleDraft;

  useEffect(() => {
    persistChatHistory(messages);
  }, [messages]);

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

  /**
   * Anexa a resposta em bolhas curtas, com “digitando…” entre elas.
   * Sem TTS — só chat. Cancela se replyGen subir (nova pergunta / Limpar).
   */
  const speakAnswer = useCallback(async (answer: string) => {
    const gen = replyGen.current;
    const blocks = splitJarvisReply(answer);
    if (blocks.length === 0) {
      if (gen === replyGen.current) setMode("idle");
      return;
    }
    for (let i = 0; i < blocks.length; i++) {
      if (gen !== replyGen.current) return;
      setMessages((m) => [...m, { from: "jarvis", text: blocks[i]! }]);
      if (i < blocks.length - 1) {
        setMode("thinking");
        await sleepMs(typingDelayMs(blocks[i + 1]!));
        if (gen !== replyGen.current) return;
      }
    }
    if (gen === replyGen.current) setMode("idle");
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
    if (dictating || dictateBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicHint("Sem microfone neste aparelho — digita no campo.");
      return;
    }

    dictateDiscardRef.current = false;
    dictateBaseRef.current = draftText;
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
        if (dictateDiscardRef.current) {
          stream.getTracks().forEach((t) => t.stop());
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
        setDictating(false);
        setDictateBusy(false);
      });
  }, [dictateBusy, dictating, draftText]);

  const authorizeChallenge = useCallback(async () => {
    if (!session || !challengeDraftRef.current || commitBusy) return;
    const draft = challengeDraftRef.current;
    if (!challengeDraftReady(draft.form)) {
      speakAnswer(`Ainda falta ${missingChallengeLabels(validateChallengeForm(draft.form)).join(", ")}.`);
      return;
    }
    setCommitBusy(true);
    setMode("thinking");
    const res = await commitChallenge(session.tenantId, draft.form);
    setCommitBusy(false);
    if (!res.ok) {
      speakAnswer(res.reason);
      return;
    }
    setChallengeDraft(null);
    challengeDraftRef.current = null;
    setCreatedItem({ kind: "challenge", id: res.id, name: res.name });
    speakAnswer(`Fechado. Desafio “${res.name}” criado. Tem o link aí embaixo.`);
  }, [commitBusy, session, speakAnswer]);

  const authorizeGoal = useCallback(async () => {
    if (!session || !goalDraftRef.current || commitBusy) return;
    const draft = goalDraftRef.current;
    if (!goalCanCommit(draft)) {
      // Sem falas fixas: o Gestor completa no chat e o Gemini pergunta.
      speakAnswer("Ainda não fechou pra gravar. Me completa no chat o que falta.");
      return;
    }
    setCommitBusy(true);
    setMode("thinking");
    // Meta no chat grava como rascunho — Gestor revisa/publica em Performance > Metas.
    const res = await commitGoal(session.tenantId, draft.form, { published: false });
    setCommitBusy(false);
    if (!res.ok) {
      speakAnswer(res.reason);
      return;
    }
    setGoalDraft(null);
    goalDraftRef.current = null;
    setCreatedItem({ kind: "goal", id: res.id, name: res.name, asDraft: true });
    const periodLabel =
      draft.form.startsOn && draft.form.endsOn
        ? ` (${draft.form.startsOn.slice(8, 10)}/${draft.form.startsOn.slice(5, 7)} a ${draft.form.endsOn.slice(8, 10)}/${draft.form.endsOn.slice(5, 7)})`
        : "";
    speakAnswer(
      `Pronto. Salvei como rascunho “${res.name}”${periodLabel}, igual o botão Salvar rascunho em Metas. Abre o link, revisa/edita e publica quando quiser.`,
    );
  }, [commitBusy, session, speakAnswer]);

  const authorizeSchedule = useCallback(async () => {
    if (!session || !scheduleDraftRef.current || commitBusy) return;
    const draft = scheduleDraftRef.current;
    if (!scheduleDraftReady(draft.form)) {
      speakAnswer(`Ainda falta ${missingScheduleLabels(validateScheduleDraft(draft.form)).join(", ")}.`);
      return;
    }
    setCommitBusy(true);
    setMode("thinking");
    const res = await commitSchedule(session.tenantId, draft.form);
    setCommitBusy(false);
    if (!res.ok) {
      speakAnswer(res.reason);
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
      `Pronto. Escala de ${label} gerada pra ${res.people} pessoa${res.people === 1 ? "" : "s"}.${keepNote}`,
    );
  }, [commitBusy, session, speakAnswer]);

  const replyLocal = useCallback(
    async (q: string, ctx: ReturnType<typeof jarvisContextFromSession>, finish: (a: string) => void) => {
      const intent = classifyIntent(q);

      if (intent === "stay_in_chat" || looksLikeLeaveChatRequest(q)) {
        finish(STAY_IN_CHAT_REPLY);
        return;
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
        goalDraftRef.current = draft;
        setGoalDraft(null);
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
    [session],
  );

  const reply = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || !session || !isOwner(session.role)) return;
      const gen = ++replyGen.current;
      setMessages((m) => [...m, { from: "user", text: q }]);
      setDraftText("");
      setMode("thinking");
      setMicHint(null);
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
        speakAnswer(answer);
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
        if (scheduleDraftRef.current && !goalDraftRef.current && !/\bmeta\b/.test(n)) {
          void authorizeSchedule();
          return;
        }
        // Meta: remonta pelo historico; se pronto grava, senao o Gemini pergunta o que falta.
        if (goalDraftRef.current || /\bmeta\b/.test(n) || /vamos criar|cria(r)? |monta(r)? /.test(n)) {
          void (async () => {
            if (gen !== replyGen.current) return;
            const historyBlob = [...messagesRef.current, { from: "user", text: q }]
              .slice(-16)
              .map((m) => `${m.from}: ${m.text}`)
              .join("\n");
            const { draft } = await discussGoal(historyBlob || q, ctx, goalDraftRef.current);
            if (gen !== replyGen.current) return;
            goalDraftRef.current = draft;
            setGoalDraft(null);
            setChallengeDraft(null);
            challengeDraftRef.current = null;
            setScheduleDraft(null);
            scheduleDraftRef.current = null;
            setCreatedItem(null);
            if (goalCanCommit(draft)) {
              await authorizeGoal();
              return;
            }
            const history: LlmChatMessage[] = messagesRef.current
              .slice(-12)
              .map((m) => ({
                role: m.from === "user" ? "user" : "assistant",
                content: m.text,
              }));
            const g = draft.form;
            const missing = missingGoalLabels(validateGoalDraft(g));
            const llm = await jarvisLlmTurn(
              history,
              ctx,
              q,
              {
                goalDraftSummary: `${g.name || "sem nome"} · alvo ${g.target ?? "?"} · ${g.startsOn ?? "?"} a ${g.endsOn ?? "?"}`,
                goalDraftMissing: missing.length ? missing.join(", ") : null,
              },
            );
            if (gen !== replyGen.current) return;
            const raw = llm.ok ? llm.content.trim() : "";
            finish(
              raw && !looksLikeLeakedGoalFacts(raw)
                ? raw
                : naturalGoalAskFromDraft(draft),
            );
          })();
          return;
        }
        if (scheduleDraftRef.current) {
          void authorizeSchedule();
          return;
        }
        finish("Não tenho rascunho pendente. Manda um desafio, uma meta ou a escala que a gente monta.");
        return;
      }

      // “Abre tela / rola” — resposta fixa; o resto a IA interpreta (histórico + rascunho aberto).
      if (intent === "stay_in_chat" || looksLikeLeaveChatRequest(q)) {
        finish(STAY_IN_CHAT_REPLY);
        return;
      }

      const applyPeriodHint = () => {
        syncScopePeriodFromQuestion(q, location.pathname, location.search, navigate);
      };

      const history: LlmChatMessage[] = messagesRef.current
        .slice(-12)
        .map((m) => ({
          role: m.from === "user" ? "user" : "assistant",
          content: m.text,
        }));

      const llmSession = (): JarvisLlmSession => {
        const draft = goalDraftRef.current;
        const g = draft?.form;
        const c = challengeDraftRef.current?.form;
        const s = scheduleDraftRef.current?.form;
        const missing = g ? missingGoalLabels(validateGoalDraft(g)) : [];
        return {
          goalDraftSummary: g
            ? `${g.name || "sem nome"} · alvo ${g.target ?? "?"} · ${g.startsOn ?? "?"} a ${g.endsOn ?? "?"} · ${g.tiers.length} níveis · modo ${g.tierMode}`
            : null,
          goalDraftMissing: missing.length ? missing.join(", ") : null,
          challengeDraftSummary: c ? `${c.name || "sem nome"} · modo ${c.mode} · métrica ${c.metric}` : null,
          scheduleDraftSummary: s ? `${s.monthStart || "?"} · loja ${s.storeId || "?"}` : null,
        };
      };

      const llmHooks = (): JarvisLlmHooks => ({
        onDraftGoal: async (request) => {
          setChallengeDraft(null);
          challengeDraftRef.current = null;
          setScheduleDraft(null);
          scheduleDraftRef.current = null;
          const { draft, reply } = await discussGoal(request || q, ctx, goalDraftRef.current);
          goalDraftRef.current = draft;
          setGoalDraft(null);
          setCreatedItem(null);
          const storeName =
            ctx.network.find((s) => s.id === draft.form.storeId)?.tradeName ??
            ctx.stores.find((s) => s.id === draft.form.storeId)?.tradeName ??
            "";
          return reply || formatGoalFactsForModel(draft, storeName);
        },
        onDraftChallenge: async (request) => {
          setGoalDraft(null);
          goalDraftRef.current = null;
          setScheduleDraft(null);
          scheduleDraftRef.current = null;
          const { draft } = await discussChallenge(request || q, ctx, challengeDraftRef.current);
          setChallengeDraft(draft);
          challengeDraftRef.current = draft;
          setCreatedItem(null);
          return "Rascunho de desafio atualizado no app (card Autorizar). Fale naturalmente; gravar so com Autorizar.";
        },
        onDraftSchedule: async (request) => {
          setChallengeDraft(null);
          challengeDraftRef.current = null;
          setGoalDraft(null);
          goalDraftRef.current = null;
          const { draft } = await discussSchedule(request || q, ctx, scheduleDraftRef.current);
          setScheduleDraft(draft);
          scheduleDraftRef.current = draft;
          setCreatedItem(null);
          return "Rascunho de escala atualizado no app (card Autorizar). Fale naturalmente; gravar so com Autorizar.";
        },
      });

      void (async () => {
        // LLM-first (Gemini): a IA escolhe tools e SEMPRE redige a fala.
        const llm = await jarvisLlmTurn(history, ctx, q, llmSession(), llmHooks());
        if (gen !== replyGen.current) return;

        if (!llm.ok) {
          if (llm.reason === "gemini_not_configured" || llm.reason === "openai_not_configured") {
            setMicHint("IA ainda sem chave no servidor. Usando modo local.");
          }
          applyPeriodHint();
          await replyLocal(q, ctx, finish);
          return;
        }

        applyPeriodHint();

        // Hooks ja aplicaram rascunhos; nunca mostre estado interno da tool no chat.
        const raw = llm.content.trim();
        if (raw && !looksLikeLeakedGoalFacts(raw)) {
          finish(raw);
          return;
        }
        if (goalDraftRef.current) {
          finish(naturalGoalAskFromDraft(goalDraftRef.current));
          return;
        }
        finish("Me fala mais um detalhe?");
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

  const clearChat = useCallback(() => {
    replyGen.current += 1;
    cancelDictate();
    setMessages([]);
    persistChatHistory([]);
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
  }, [cancelDictate]);

  useEffect(() => {
    return () => {
      cancelDictate();
    };
  }, [cancelDictate]);

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
      dictating,
      dictateBusy,
      dictateSeconds,
      dictateLevels,
      startDictate,
      finishDictate,
      cancelDictate,
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
      commitBusy,
      createdItem,
      dictateBusy,
      dictateLevels,
      dictateSeconds,
      dictating,
      draftText,
      finishDictate,
      goalDraft,
      messages,
      micHint,
      mode,
      reply,
      scheduleDraft,
      speakAnswer,
      startDictate,
      storeNameFor,
    ],
  );

  return <JarvisContext.Provider value={api}>{children}</JarvisContext.Provider>;
}
