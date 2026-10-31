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
import { monthYearTitle } from "@/lib/format";
import { paths } from "@/router/paths";
import { useSession } from "@/session/SessionProvider";
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
  clearGoalDraftSession,
  emptyGoalAssembly,
  formatGoalFactsForModel,
  goalAssemblyPendingSteps,
  goalCanPersist,
  loadGoalDraftSession,
  looksLikeGoalConversation,
  looksLikeLeakedGoalFacts,
  looksLikeLostGoalReply,
  looksLikeStallingGoalReply,
  missingGoalLabels,
  naturalGoalAskFromDraft,
  persistGoalDraftSession,
  speakGoalDraftConfig,
  validateGoalDraft,
  type GoalAssemblyPath,
  type GoalDraft,
} from "./goalDraft";
import {
  goalDraftFingerprint,
  looksLikePrematureSaveOffer,
  looksLikeValueInconsistency,
  speakGoalSavedSuccess,
  speakValueInconsistency,
} from "./goalContract";
import { applyGoalTurn } from "./goalTurnApply";
import {
  assertLlmSpeechAfterMutation,
  speechClaimsCopyOk,
  speechClaimsSaved,
} from "./goalTurnTrace";
import { looksLikeUnfinishedAnalysisPromise } from "./llmClient";
import { classifyJarvisFailure, logJarvisError } from "./jarvisErrors";
import {
  blobToBase64,
  jarvisLlmTurn,
  jarvisTranscribe,
  type JarvisLlmHooks,
  type JarvisLlmSession,
  type LlmChatMessage,
} from "./llmClient";
import { clearJarvisMemory, formatMemoryForModel, loadJarvisMemory } from "./memoryRepo";
import { commitSchedule } from "./scheduleCommit";
import {
  discussSchedule,
  missingScheduleLabels,
  scheduleDraftReady,
  validateScheduleDraft,
  type ScheduleDraft,
} from "./scheduleDraft";
import {
  clearChatHistory,
  loadChatHistory,
  persistChatHistory,
  type JarvisMessage,
  type JarvisMessageLink,
} from "./chatStorage";
import { syncScopePeriodFromQuestion } from "./syncPeriod";

export type { JarvisMessage, JarvisMessageLink };
export type JarvisMode = "idle" | "thinking";
export type JarvisCreated =
  | { kind: "challenge"; id: string; name: string }
  | { kind: "schedule"; name: string };

/** Correlação de sessão sem PII completa. */
function shortSessionKey(tenantId: string, membershipId: string): string {
  return `${tenantId.slice(0, 8)}.${membershipId.slice(0, 8)}`;
}

function readTopbarStoreIds(): string[] {
  try {
    const raw = sessionStorage.getItem("wedash.store") ?? sessionStorage.getItem("gestao.filial");
    if (!raw) return [];
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export type AssemblyPathOfferUi = {
  hasPrior: boolean;
  priorLabel: string | null;
  selected: GoalAssemblyPath | null;
};

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
  /** Oferta dos 3 caminhos — só quando path ainda pendente. */
  assemblyPathOffer: AssemblyPathOfferUi | null;
  pathSelectBusy: boolean;
  selectAssemblyPath: (path: GoalAssemblyPath) => void;
  commitBusy: boolean;
  /** Microfone → grava → Whisper no campo (UI REC estilo Néctar). */
  dictating: boolean;
  dictateBusy: boolean;
  dictateSeconds: number;
  dictateLevels: number[];
  startDictate: () => void;
  finishDictate: () => void;
  cancelDictate: () => void;
  reply: (q: string, opts?: { retry?: boolean }) => void;
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
  const [assemblyPathOffer, setAssemblyPathOffer] = useState<AssemblyPathOfferUi | null>(null);
  const [pathSelectBusy, setPathSelectBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictateBusy, setDictateBusy] = useState(false);
  const [dictateSeconds, setDictateSeconds] = useState(0);
  const [dictateLevels, setDictateLevels] = useState<number[]>(() => Array.from({ length: 40 }, () => 0.12));

  const endRef = useRef<HTMLDivElement>(null);
  const challengeDraftRef = useRef<ChallengeDraft | null>(null);
  const goalDraftRef = useRef<GoalDraft | null>(loadGoalDraftSession());
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
  const memoryTextRef = useRef<string>("Nenhuma memória de longo prazo ainda.");
  const pendingSpeakExtrasRef = useRef<{ link?: JarvisMessageLink; retryOf?: string } | null>(null);
  /** Escopo cuja thread já foi reidratada do disco — evita persistir [] e apagar a conversa. */
  const chatHydratedForRef = useRef<string | null>(null);
  /** Idempotência de gravação: fingerprint → id já salvo. */
  const completedGoalSavesRef = useRef<Map<string, { id: string; name: string; target: number }>>(
    new Map(),
  );

  challengeDraftRef.current = challengeDraft;
  // Meta no chat e so-texto: state fica null (sem card), mas o rascunho vive no ref.
  // Nao espelhar null do state no ref — isso apagava o fio no turno seguinte ("isso, novembro").
  if (goalDraft) goalDraftRef.current = goalDraft;
  scheduleDraftRef.current = scheduleDraft;

  // Reidrata thread quando a sessão fica pronta (F5 / PWA).
  useEffect(() => {
    const tenantId = session?.tenantId;
    const membershipId = session?.membershipId;
    if (!tenantId || !membershipId) return;
    const scope = `${tenantId}:${membershipId}`;
    if (chatHydratedForRef.current === scope) return;
    chatHydratedForRef.current = scope;
    const loaded = loadChatHistory(tenantId, membershipId);
    setMessages(loaded);
    messagesRef.current = loaded;
  }, [session?.tenantId, session?.membershipId]);

  useEffect(() => {
    const tenantId = session?.tenantId;
    const membershipId = session?.membershipId;
    if (!tenantId || !membershipId) return;
    if (chatHydratedForRef.current !== `${tenantId}:${membershipId}`) return;
    persistChatHistory(tenantId, membershipId, messages);
  }, [messages, session?.tenantId, session?.membershipId]);

  const syncGoalDraft = useCallback((draft: GoalDraft | null) => {
    goalDraftRef.current = draft;
    persistGoalDraftSession(draft);
    // Componente só após valor efetivamente aceito (userLockedTarget) — proposedTarget sozinho não basta.
    if (
      draft &&
      draft.assembly?.valueDiscussed &&
      draft.form.target != null &&
      draft.userLockedTarget === true &&
      draft.assembly.path == null
    ) {
      setAssemblyPathOffer({
        hasPrior: draft.pendingConfigCopy != null,
        priorLabel: draft.pendingConfigCopy
          ? monthYearTitle(draft.pendingConfigCopy.from)
          : null,
        selected: null,
      });
    } else {
      setAssemblyPathOffer(null);
    }
  }, []);

  useEffect(() => {
    // Restaura oferta de caminho após refresh (rascunho na sessão).
    const d = goalDraftRef.current;
    if (d) syncGoalDraft(d);
  }, [syncGoalDraft]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, mode, challengeDraft, goalDraft, scheduleDraft, createdItem, assemblyPathOffer]);

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
   * link/retryOf vão só na última bolha.
   */
  const speakAnswer = useCallback(
    async (answer: string, extras?: { link?: JarvisMessageLink | null; retryOf?: string | null }) => {
      const gen = replyGen.current;
      const fromPending = pendingSpeakExtrasRef.current;
      pendingSpeakExtrasRef.current = null;
      const link = extras?.link ?? fromPending?.link ?? null;
      const retryOf = extras?.retryOf ?? fromPending?.retryOf ?? null;
      const blocks = splitJarvisReply(answer);
      if (blocks.length === 0) {
        if (gen === replyGen.current) setMode("idle");
        return;
      }
      for (let i = 0; i < blocks.length; i++) {
        if (gen !== replyGen.current) return;
        const isLast = i === blocks.length - 1;
        setMessages((m) =>
          gen !== replyGen.current
            ? m
            : [
                ...m,
                {
                  from: "jarvis" as const,
                  text: blocks[i]!,
                  link: isLast ? link : null,
                  retryOf: isLast ? retryOf : null,
                },
              ],
        );
        if (i < blocks.length - 1) {
          setMode("thinking");
          await sleepMs(typingDelayMs(blocks[i + 1]!));
          if (gen !== replyGen.current) return;
        }
      }
      if (gen === replyGen.current) setMode("idle");
    },
    [],
  );


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

  /** Grava desafio. silent=true → só retorna texto (tool commit_draft); false → fala no chat (botão Autorizar). */
  const authorizeChallenge = useCallback(
    async (opts?: { silent?: boolean }): Promise<string | void> => {
      const silent = opts?.silent === true;
      if (!session || !challengeDraftRef.current || commitBusy) {
        return silent ? "Não tem rascunho de desafio aberto pra gravar." : undefined;
      }
      const draft = challengeDraftRef.current;
      if (!challengeDraftReady(draft.form)) {
        const msg = `Ainda falta ${missingChallengeLabels(validateChallengeForm(draft.form)).join(", ")}.`;
        if (silent) return msg;
        speakAnswer(msg);
        return;
      }
      setCommitBusy(true);
      setMode("thinking");
      const res = await commitChallenge(session.tenantId, draft.form);
      setCommitBusy(false);
      if (!res.ok) {
        if (silent) return res.reason;
        speakAnswer(res.reason);
        return;
      }
      setChallengeDraft(null);
      challengeDraftRef.current = null;
      setCreatedItem({ kind: "challenge", id: res.id, name: res.name });
      const msg = `Fechado. Desafio “${res.name}” criado. Tem o link aí embaixo.`;
      if (silent) return msg;
      speakAnswer(msg);
    },
    [commitBusy, session, speakAnswer],
  );

  const authorizeGoal = useCallback(
    async (opts?: { silent?: boolean }): Promise<string | void> => {
      const silent = opts?.silent === true;
      if (!session || !goalDraftRef.current || commitBusy) {
        return silent ? "Não tem proposta de meta aberta pra gravar." : undefined;
      }
      const draft = goalDraftRef.current;
      if (!goalCanPersist(draft)) {
        const missing = missingGoalLabels(validateGoalDraft(draft.form));
        const msg = !draft.pendingCommit?.authorized
          ? "Ainda falta confirmar esta versão. Peça para salvar o rascunho — eu mostro o resumo e você confirma."
          : missing.length
            ? `Ainda não dá pra gravar a meta. Falta: ${missing.join(", ")}.`
            : "A configuração mudou depois do resumo — peço confirmação de novo.";
        if (silent) return msg;
        void speakAnswer(msg);
        return;
      }
      const targetSaved = draft.form.target!;
      const fp = goalDraftFingerprint(draft.form);
      const already = completedGoalSavesRef.current.get(fp);
      if (already) {
        const msg = speakGoalSavedSuccess({
          name: already.name,
          target: already.target,
          asDraft: true,
        });
        pendingSpeakExtrasRef.current = {
          link: { label: "Abrir no editor de metas", to: paths.goalEdit(already.id) },
        };
        if (silent) return msg;
        void speakAnswer(msg);
        return;
      }
      setCommitBusy(true);
      setMode("thinking");
      const res = await commitGoal(session.tenantId, draft.form, { published: false });
      setCommitBusy(false);
      if (!res.ok) {
        syncGoalDraft({
          ...draft,
          pendingCommit: draft.pendingCommit
            ? { ...draft.pendingCommit, authorized: false, awaitingConfirm: true }
            : null,
        });
        const classified = classifyJarvisFailure(res.reason, { duringSave: true });
        logJarvisError("authorizeGoal", { kind: classified.kind, reason: res.reason });
        if (silent) return classified.message;
        void speakAnswer(classified.message);
        return;
      }
      completedGoalSavesRef.current.set(fp, {
        id: res.id,
        name: res.name,
        target: targetSaved,
      });
      setGoalDraft(null);
      syncGoalDraft(null);
      clearGoalDraftSession();
      setCreatedItem(null);
      const msg = speakGoalSavedSuccess({
        name: res.name,
        target: targetSaved,
        asDraft: true,
      });
      pendingSpeakExtrasRef.current = {
        link: { label: "Abrir no editor de metas", to: paths.goalEdit(res.id) },
      };
      if (silent) return msg;
      void speakAnswer(msg);
    },
    [commitBusy, session, speakAnswer, syncGoalDraft],
  );

  const authorizeSchedule = useCallback(
    async (opts?: { silent?: boolean }): Promise<string | void> => {
      const silent = opts?.silent === true;
      if (!session || !scheduleDraftRef.current || commitBusy) {
        return silent ? "Não tem rascunho de escala aberto pra gravar." : undefined;
      }
      const draft = scheduleDraftRef.current;
      if (!scheduleDraftReady(draft.form)) {
        const msg = `Ainda falta ${missingScheduleLabels(validateScheduleDraft(draft.form)).join(", ")}.`;
        if (silent) return msg;
        speakAnswer(msg);
        return;
      }
      setCommitBusy(true);
      setMode("thinking");
      const res = await commitSchedule(session.tenantId, draft.form);
      setCommitBusy(false);
      if (!res.ok) {
        if (silent) return res.reason;
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
      const msg = `Pronto. Escala de ${label} gerada pra ${res.people} pessoa${res.people === 1 ? "" : "s"}.${keepNote}`;
      if (silent) return msg;
      speakAnswer(msg);
    },
    [commitBusy, session, speakAnswer],
  );

  const reply = useCallback(
    (question: string, opts?: { retry?: boolean }) => {
      const q = question.trim();
      if (!q || !session || !isOwner(session.role)) return;
      const gen = ++replyGen.current;
      if (!opts?.retry) {
        setMessages((m) => [...m, { from: "user", text: q }]);
      } else {
        // Remove botões de retry anteriores desta pergunta para evitar duplicata visual.
        setMessages((m) =>
          m.map((msg) => (msg.retryOf === q ? { ...msg, retryOf: null } : msg)),
        );
      }
      setDraftText("");
      setMode("thinking");
      setMicHint(null);
      const ctx = jarvisContextFromSession(session, readTopbarStoreIds());

      // Fala = só o modelo. App não monta script de conversa.
      const finish = (answer: string, extras?: { link?: JarvisMessageLink; retryOf?: string }) => {
        if (gen !== replyGen.current) return;
        if (looksLikeLeakedGoalFacts(answer) || !answer.trim()) {
          const classified = classifyJarvisFailure("empty_or_leaked");
          void speakAnswer(classified.message, {
            retryOf: classified.canRetry ? q : undefined,
          });
          return;
        }
        void speakAnswer(answer, extras);
      };

      const applyPeriodHint = () => {
        syncScopePeriodFromQuestion(q, location.pathname, location.search, navigate);
      };

      const history: LlmChatMessage[] = messagesRef.current
        .slice(-12)
        .map((m) => ({
          role: m.from === "user" ? "user" : "assistant",
          content: m.text,
        }));

      let goalTurnApplied = false;
      let goalSpokenReply: string | null = null;
      let goalShouldCommit = false;
      let goalAllowLlm = false;
      let goalMutatedThisTurn = false;
      const turnId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionKey = shortSessionKey(session.tenantId, session.membershipId);
      const llmSession = (): JarvisLlmSession => {
        const draft = goalDraftRef.current;
        const g = draft?.form;
        const a = draft?.assembly;
        const c = challengeDraftRef.current?.form;
        const s = scheduleDraftRef.current?.form;
        const missing = g ? missingGoalLabels(validateGoalDraft(g)) : [];
        const pending = draft ? goalAssemblyPendingSteps(draft) : [];
        const storeName =
          g?.storeId != null
            ? (ctx.network.find((x) => x.id === g.storeId)?.tradeName ??
              ctx.stores.find((x) => x.id === g.storeId)?.tradeName ??
              "")
            : "";
        return {
          goalDraftSummary: g
            ? `${g.name || "sem nome"} · alvo ${g.target ?? "?"} · ${g.startsOn ?? "?"} a ${g.endsOn ?? "?"} · ${g.tiers.length} níveis · ${g.groups.length} grupos · modo ${g.tierMode}` +
              (draft?.copiedFrom
                ? ` · origem ${draft.copiedFrom.from}`
                : "")
            : null,
          goalDraftMissing: missing.length ? missing.join(", ") : null,
          goalPeriodConfirmed: a?.periodConfirmed ?? null,
          goalNextStep: pending.length ? pending.join(" → ") : null,
          goalAssemblyPath: a?.path ?? null,
          goalTurnApplied,
          goalCopyStatus: draft?.copyStatus ?? null,
          goalOperationalState: draft ? formatGoalFactsForModel(draft, storeName) : null,
          challengeDraftSummary: c ? `${c.name || "sem nome"} · modo ${c.mode} · métrica ${c.metric}` : null,
          scheduleDraftSummary: s ? `${s.monthStart || "?"} · loja ${s.storeId || "?"}` : null,
          longTermMemory: memoryTextRef.current,
        };
      };

      const llmHooks = (): JarvisLlmHooks => ({
        onDraftGoal: async (request) => {
          setChallengeDraft(null);
          challengeDraftRef.current = null;
          setScheduleDraft(null);
          scheduleDraftRef.current = null;
          // Alias de applyGoalTurn (mesmo turnId) — idempotente se o eager já rodou.
          const utterance = q.trim() || request;
          const turn = await applyGoalTurn(utterance, ctx, goalDraftRef.current, {
            turnId,
            sessionKey,
          });
          syncGoalDraft(turn.draft);
          setGoalDraft(null);
          setCreatedItem(null);
          return (
            turn.facts ||
            formatGoalFactsForModel(turn.draft, "") +
              (turn.skipped ? "\nturno_ja_aplicado: true" : "")
          );
        },
        onDraftChallenge: async (request) => {
          setGoalDraft(null);
          syncGoalDraft(null);
          setScheduleDraft(null);
          scheduleDraftRef.current = null;
          const { draft, spokenReply } = await discussChallenge(
            request || q,
            ctx,
            challengeDraftRef.current,
          );
          setChallengeDraft(draft);
          challengeDraftRef.current = draft;
          setCreatedItem(null);
          if (spokenReply) {
            return `Falta a filial. Diga exatamente ao Gestor (sem inventar loja):\n${spokenReply}`;
          }
          return "Rascunho de desafio atualizado no app (card Autorizar). Fale naturalmente; pra gravar use commit_draft ou o botão Autorizar.";
        },
        onDraftSchedule: async (request) => {
          setChallengeDraft(null);
          challengeDraftRef.current = null;
          setGoalDraft(null);
          syncGoalDraft(null);
          const { draft, spokenReply } = await discussSchedule(
            request || q,
            ctx,
            scheduleDraftRef.current,
          );
          setScheduleDraft(draft);
          scheduleDraftRef.current = draft;
          setCreatedItem(null);
          if (spokenReply) {
            return `Falta a filial. Diga exatamente ao Gestor (sem inventar loja):\n${spokenReply}`;
          }
          return "Rascunho de escala atualizado no app (card Autorizar). Fale naturalmente; pra gravar use commit_draft ou o botão Autorizar.";
        },
        onCommitDraft: async (target) => {
          const t = target.trim().toLowerCase();
          if (t === "challenge") {
            return (await authorizeChallenge({ silent: true })) ?? "Não consegui gravar o desafio.";
          }
          if (t === "schedule") {
            return (await authorizeSchedule({ silent: true })) ?? "Não consegui gravar a escala.";
          }
          if (goalDraftRef.current || t === "goal") {
            // P0: commit NÃO reexecuta discussGoal — só valida pendingCommit + form.
            setChallengeDraft(null);
            challengeDraftRef.current = null;
            setScheduleDraft(null);
            scheduleDraftRef.current = null;
            return (await authorizeGoal({ silent: true })) ?? "Não consegui gravar a meta.";
          }
          return "Não tem rascunho aberto pra gravar. Monte meta, desafio ou escala antes.";
        },
        onDiscardDraft: async (target) => {
          const t = target.trim().toLowerCase();
          const cleared: string[] = [];
          if (t === "all" || t === "goal") {
            if (goalDraftRef.current) {
              setGoalDraft(null);
              syncGoalDraft(null);
              cleared.push("meta");
            }
          }
          if (t === "all" || t === "challenge") {
            if (challengeDraftRef.current) {
              setChallengeDraft(null);
              challengeDraftRef.current = null;
              cleared.push("desafio");
            }
          }
          if (t === "all" || t === "schedule") {
            if (scheduleDraftRef.current) {
              setScheduleDraft(null);
              scheduleDraftRef.current = null;
              cleared.push("escala");
            }
          }
          if (!cleared.length) return "Não tinha rascunho aberto pra descartar.";
          return `Descartei: ${cleared.join(", ")}. Pode falar de novo o que quer montar.`;
        },
      });

      void (async () => {
        const facts = await loadJarvisMemory(ctx.tenantId, ctx.membershipId);
        if (gen !== replyGen.current) return;
        memoryTextRef.current = formatMemoryForModel(facts);

        // Fase 4: fio de meta → applyGoalTurn (classify + motor) antes do LLM.
        // interpret_goal_op alimenta a classificação; não compete com ela.
        const recentMsgs = [...messagesRef.current, { from: "user" as const, text: q }].slice(-16);
        const onGoalThread =
          goalDraftRef.current != null ||
          looksLikeGoalConversation(recentMsgs, q, ctx.today);
        if (onGoalThread) {
          const before = goalDraftRef.current;
          const beforePath = before?.assembly?.path ?? null;
          const beforePending = before ? goalAssemblyPendingSteps(before).join("|") : "";
          const historyBlob = recentMsgs.map((m) => `${m.from}: ${m.text}`).join("\n");
          const { resolveGoalOpIntent } = await import("./goalOpInterpret");
          const opIntent = await resolveGoalOpIntent(q, before, ctx.today);
          const turn = await applyGoalTurn(historyBlob, ctx, before, {
            turnId,
            intent: opIntent,
            sessionKey,
          });
          if (gen !== replyGen.current) return;
          syncGoalDraft(turn.draft);
          const afterPending = goalAssemblyPendingSteps(turn.draft).join("|");
          goalTurnApplied =
            !turn.skipped &&
            (turn.mutates ||
              (turn.draft.assembly?.path ?? null) !== beforePath ||
              afterPending !== beforePending);
          goalMutatedThisTurn = turn.mutates && !turn.skipped;
          goalAllowLlm = turn.allowLlm;
          if (!turn.skipped && turn.speech && !turn.allowLlm) {
            goalSpokenReply = turn.speech;
          }
          if (!turn.skipped && turn.shouldCommit) goalShouldCommit = true;
        }

        // Commit autorizado neste turno — fala = resultado real de saveGoal.
        if (goalShouldCommit) {
          const msg = await authorizeGoal({ silent: true });
          if (gen !== replyGen.current) return;
          finish(msg || "Não consegui gravar a meta.");
          return;
        }

        // Operação com fala do motor — Provider NÃO chama chat (Fase 4).
        if (goalSpokenReply && !goalAllowLlm) {
          finish(goalSpokenReply);
          return;
        }

        // Consultiva / sem speech: LLM com estado + tools (sem mutar por conta própria).
        const llm = await jarvisLlmTurn(history, ctx, q, llmSession, llmHooks());
        if (gen !== replyGen.current) return;

        applyPeriodHint();

        const refreshed = await loadJarvisMemory(ctx.tenantId, ctx.membershipId);
        if (gen !== replyGen.current) return;
        memoryTextRef.current = formatMemoryForModel(refreshed);

        const draftNow = goalDraftRef.current;
        const runAnalysisSafetyNet = async (): Promise<string> => {
          try {
            const { loadSalesBrief } = await import("./salesBrief");
            const brief = await loadSalesBrief(ctx, q, q);
            let answer =
              brief.trim() ||
              "Não achei venda sincronizada para essa consulta. Vale conferir o sync ou o filtro de filial.";
            if (draftNow?.form.storeId && draftNow.form.startsOn && !draftNow.userLockedTarget) {
              const { suggestGoalTarget } = await import("./goalDraft");
              const suggested = await suggestGoalTarget(ctx, draftNow.form.storeId, {
                from: draftNow.form.startsOn,
                to: draftNow.form.endsOn || draftNow.form.startsOn,
              });
              if (suggested) {
                syncGoalDraft({
                  ...draftNow,
                  proposal: suggested,
                  proposedTarget: suggested.amount,
                  assembly: {
                    ...(draftNow.assembly ?? emptyGoalAssembly()),
                    valueDiscussed: true,
                  },
                });
                answer = `${brief.trim()}\n\n${suggested.chatBlocks.join("\n\n")}`;
              }
            }
            return answer;
          } catch {
            return "Não consegui consultar as vendas agora. Pode tentar de novo em instantes?";
          }
        };

        if (!llm.ok) {
          const reason = llm.reason || "erro";
          // Limite de tools / resposta inesperada no meio de análise: entrega desfecho.
          if (reason === "tool_loop_limit" || reason === "unexpected_response") {
            const recovered = await runAnalysisSafetyNet();
            if (gen !== replyGen.current) return;
            finish(recovered, { retryOf: q });
            return;
          }
          const classified = classifyJarvisFailure(reason);
          logJarvisError("llmTurn", { kind: classified.kind, reason });
          if (reason === "openai_not_configured") {
            setMicHint("Falta configurar a IA no servidor.");
          } else {
            setMicHint(null);
          }
          finish(classified.message, {
            retryOf: classified.canRetry ? q : undefined,
          });
          return;
        }

        let answer = llm.content.trim();
        // Prometeu análise sem resultado — rede de segurança se o loop não forçou a tool.
        if (looksLikeUnfinishedAnalysisPromise(answer)) {
          answer = await runAnalysisSafetyNet();
        } else if (draftNow && looksLikeValueInconsistency(q)) {
          answer = speakValueInconsistency(draftNow);
        } else if (draftNow && looksLikePrematureSaveOffer(answer) && !goalCanPersist(draftNow)) {
          answer = naturalGoalAskFromDraft(draftNow);
        } else if (
          draftNow &&
          !looksLikeValueInconsistency(q) &&
          (looksLikeStallingGoalReply(answer) || looksLikeLostGoalReply(answer, draftNow))
        ) {
          answer = naturalGoalAskFromDraft(draftNow);
        }
        // Rede de segurança: se o modelo inventou “não achei novembro” com cópia ok no estado.
        if (
          draftNow?.copyStatus === "ok" &&
          /nao (encontrei|achei|localizei)|não (encontrei|achei|localizei)|meta publicada/.test(
            answer.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""),
          )
        ) {
          answer = speakGoalDraftConfig(draftNow);
        }
        // Fase 5: LLM não afirma cópia/gravação sem estado correspondente.
        if (draftNow) {
          const falseCopy = speechClaimsCopyOk(answer) && draftNow.copyStatus !== "ok";
          const falseSave = speechClaimsSaved(answer) && !goalShouldCommit;
          if (falseCopy || falseSave) {
            logJarvisError("invariant.speech_vs_state", {
              kind: "validation",
              reason: falseCopy ? "copy_claim_without_ok" : "save_claim_without_success",
            });
            answer = speakGoalDraftConfig(draftNow);
          } else if (goalMutatedThisTurn) {
            const gate = assertLlmSpeechAfterMutation({
              mutates: true,
              speechSource: "llm",
              draft: draftNow,
            });
            if (!gate.ok) {
              // Só registra — a fala do LLM pode ser consultiva; commit já exige pending.
              logJarvisError("invariant.llm_after_mutation", {
                kind: "validation",
                reason: gate.violation.id,
              });
            }
          }
        }
        finish(answer);
      })();
    },
    [
      authorizeChallenge,
      authorizeGoal,
      authorizeSchedule,
      location.pathname,
      location.search,
      navigate,
      session,
      speakAnswer,
      syncGoalDraft,
    ],
  );

  const selectAssemblyPath = useCallback(
    async (path: GoalAssemblyPath) => {
      if (!session || !isOwner(session.role) || pathSelectBusy || commitBusy) return;
      const before = goalDraftRef.current;
      if (!before || before.assembly?.path != null) return;
      setPathSelectBusy(true);
      setMode("thinking");
      setAssemblyPathOffer((o) => (o ? { ...o, selected: path } : o));
      const ctx = jarvisContextFromSession(session, readTopbarStoreIds());
      const turnId = `path-${path}-${Date.now()}`;
      try {
        const turn = await applyGoalTurn(`Selecionar caminho: ${path}`, ctx, before, {
          turnId,
          forcedPath: path,
          sessionKey: shortSessionKey(session.tenantId, session.membershipId),
        });
        syncGoalDraft(turn.draft);
        if (turn.shouldCommit) {
          const msg = await authorizeGoal({ silent: true });
          await speakAnswer(msg || "Não consegui gravar a meta.");
          return;
        }
        if (turn.speech) {
          await speakAnswer(turn.speech);
        } else {
          setMode("idle");
        }
      } catch (err) {
        const classified = classifyJarvisFailure(String(err));
        logJarvisError("selectAssemblyPath", { kind: classified.kind, raw: err });
        await speakAnswer(classified.message);
      } finally {
        setPathSelectBusy(false);
      }
    },
    [authorizeGoal, commitBusy, pathSelectBusy, session, speakAnswer, syncGoalDraft],
  );

  const clearChat = useCallback(() => {
    // Reset total: thread + rascunhos + o que o JARVIS “conhece” deste Gestor.
    replyGen.current += 1;
    cancelDictate();
    setMessages([]);
    messagesRef.current = [];
    if (session?.tenantId && session.membershipId) {
      clearChatHistory(session.tenantId, session.membershipId);
      void clearJarvisMemory(session.tenantId, session.membershipId);
    }
    setDraftText("");
    setMicHint(null);
    setMode("idle");
    setChallengeDraft(null);
    challengeDraftRef.current = null;
    setGoalDraft(null);
    syncGoalDraft(null);
    clearGoalDraftSession();
    setScheduleDraft(null);
    scheduleDraftRef.current = null;
    setCreatedItem(null);
    setAssemblyPathOffer(null);
    setPathSelectBusy(false);
    setCommitBusy(false);
    completedGoalSavesRef.current.clear();
    memoryTextRef.current = "Nenhuma memória de longo prazo ainda.";
  }, [cancelDictate, session?.membershipId, session?.tenantId, syncGoalDraft]);

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
      assemblyPathOffer,
      pathSelectBusy,
      selectAssemblyPath,
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
        void speakAnswer("Beleza, descartei o desafio.");
      },
      discardGoal: () => {
        setGoalDraft(null);
        syncGoalDraft(null);
        void speakAnswer("Beleza, descartei a meta.");
      },
      discardSchedule: () => {
        setScheduleDraft(null);
        scheduleDraftRef.current = null;
        void speakAnswer("Beleza, descartei a escala.");
      },
      storeNameFor,
      endRef,
    }),
    [
      allowed,
      assemblyPathOffer,
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
      pathSelectBusy,
      reply,
      scheduleDraft,
      selectAssemblyPath,
      speakAnswer,
      startDictate,
      storeNameFor,
      syncGoalDraft,
    ],
  );

  return <JarvisContext.Provider value={api}>{children}</JarvisContext.Provider>;
}
