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
  // Meta no chat e so-texto: state fica null (sem card), mas o rascunho vive no ref.
  // Nao espelhar null do state no ref — isso apagava o fio no turno seguinte ("isso, novembro").
  if (goalDraft) goalDraftRef.current = goalDraft;
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
      if (!goalCanCommit(draft)) {
        const missing = missingGoalLabels(validateGoalDraft(draft.form));
        const msg = missing.length
          ? `Ainda não da pra gravar a meta. Falta: ${missing.join(", ")}. Pergunte isso ao Gestor.`
          : "Ainda não fechou pra gravar. Me completa no chat o que falta.";
        if (silent) return msg;
        speakAnswer(msg);
        return;
      }
      setCommitBusy(true);
      setMode("thinking");
      // Meta no chat grava como rascunho — Gestor revisa/publica em Performance > Metas.
      const res = await commitGoal(session.tenantId, draft.form, { published: false });
      setCommitBusy(false);
      if (!res.ok) {
        if (silent) return res.reason;
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
      const msg = `Pronto. Salvei como rascunho “${res.name}”${periodLabel}, igual o botão Salvar rascunho em Metas. Abre o link, revisa/edita e publica quando quiser.`;
      if (silent) return msg;
      speakAnswer(msg);
    },
    [commitBusy, session, speakAnswer],
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
    (question: string) => {
      const q = question.trim();
      if (!q || !session || !isOwner(session.role)) return;
      const gen = ++replyGen.current;
      setMessages((m) => [...m, { from: "user", text: q }]);
      setDraftText("");
      setMode("thinking");
      setMicHint(null);
      const ctx = jarvisContextFromSession(session, readTopbarStoreIds());

      // Fala = só o modelo. App não monta script de conversa.
      const finish = (answer: string) => {
        if (gen !== replyGen.current) return;
        if (looksLikeLeakedGoalFacts(answer) || !answer.trim()) {
          speakAnswer("Deu um tropeço na resposta. Manda de novo?");
          return;
        }
        speakAnswer(answer);
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

      const llmSession = (): JarvisLlmSession => {
        const draft = goalDraftRef.current;
        const g = draft?.form;
        const a = draft?.assembly;
        const c = challengeDraftRef.current?.form;
        const s = scheduleDraftRef.current?.form;
        const missing = g ? missingGoalLabels(validateGoalDraft(g)) : [];
        let goalNextStep: string | null = null;
        if (draft && a) {
          if (!a.periodConfirmed) goalNextStep = "pedir o mês da meta";
          else if (!g?.storeId) goalNextStep = "pedir a filial";
          else if (!a.valueDiscussed || g.target == null) goalNextStep = "pedir ou sugerir o valor";
          else if (a.path == null) goalNextStep = "perguntar se copia config anterior ou monta do zero";
          else if (!a.confirmedMount) goalNextStep = "pedir confirmação para montar o rascunho";
        }
        return {
          goalDraftSummary: g
            ? `${g.name || "sem nome"} · alvo ${g.target ?? "?"} · ${g.startsOn ?? "?"} a ${g.endsOn ?? "?"} · ${g.tiers.length} níveis · modo ${g.tierMode}`
            : null,
          goalDraftMissing: missing.length ? missing.join(", ") : null,
          goalPeriodConfirmed: a?.periodConfirmed ?? null,
          goalNextStep,
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
          const { draft, reply: toolReply } = await discussGoal(request || q, ctx, goalDraftRef.current);
          goalDraftRef.current = draft;
          setGoalDraft(null);
          setCreatedItem(null);
          const storeName =
            ctx.network.find((s) => s.id === draft.form.storeId)?.tradeName ??
            ctx.stores.find((s) => s.id === draft.form.storeId)?.tradeName ??
            "";
          return toolReply || formatGoalFactsForModel(draft, storeName);
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
          return "Rascunho de desafio atualizado no app (card Autorizar). Fale naturalmente; pra gravar use commit_draft ou o botão Autorizar.";
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
            const historyBlob = [...messagesRef.current, { from: "user" as const, text: q }]
              .slice(-16)
              .map((m) => `${m.from}: ${m.text}`)
              .join("\n");
            const { draft } = await discussGoal(historyBlob || q, ctx, goalDraftRef.current);
            goalDraftRef.current = draft;
            setGoalDraft(null);
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
              goalDraftRef.current = null;
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
        // Só prompt + tools. Sem script local de conversa.
        const llm = await jarvisLlmTurn(history, ctx, q, llmSession, llmHooks());
        if (gen !== replyGen.current) return;

        applyPeriodHint();

        if (!llm.ok) {
          const reason = llm.reason || "erro";
          if (reason === "openai_not_configured") {
            setMicHint("Falta OPENAI_API_KEY no servidor.");
          } else {
            setMicHint(`IA: ${reason.slice(0, 120)}`);
          }
          finish("A IA tropeçou neste turno. Manda de novo?");
          return;
        }

        finish(llm.content.trim());
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
