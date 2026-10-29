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
} from "./speech";

export type JarvisMessage = { from: "user" | "jarvis"; text: string };
export type JarvisMode = "idle" | "listening" | "thinking" | "speaking";
export type JarvisCreated =
  | { kind: "challenge" | "goal"; id: string; name: string }
  | { kind: "schedule"; name: string };

const OPENING: JarvisMessage = {
  from: "jarvis",
  text: "E aí. Sou o JARVIS — tipo um sócio na operação. Vendas, estoque, sazonal, meta, desafio, escala… a gente conversa e eu só gravo quando você autorizar. Pode digitar ou apertar o botão de voz.",
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
  const listenAgainRef = useRef<() => void>(() => undefined);

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
            window.setTimeout(() => listenAgainRef.current(), 280);
          }
        },
      });
    } else {
      setMode("idle");
      if (opts?.listenAfter && voiceOpenRef.current) {
        window.setTimeout(() => listenAgainRef.current(), 280);
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

  const reply = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || !session || !isOwner(session.role)) return;
      const gen = ++replyGen.current;
      const inVoice = voiceOpenRef.current;
      setMessages((m) => [...m, { from: "user", text: q }]);
      setDraftText("");
      setMode("thinking");
      stopSpeaking();
      const ctx = jarvisContextFromSession(session, readTopbarStoreIds());
      const intent = classifyIntent(q);
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

      if (intent === "navigate" || looksLikeNavigate(q)) {
        const target = resolveNavigate(q, session.role);
        if (target) {
          navigate({ pathname: target.to, search: searchForRoute(target.to, location.search) });
          finish(formatNavigateReply(target));
          return;
        }
        // "abre um desafio…" sem tela clara → segue pro rascunho, não erro de navegação
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
        void discussChallenge(q, ctx, challengeDraftRef.current).then(({ reply: answer, draft }) => {
          if (gen !== replyGen.current) return;
          setChallengeDraft(draft);
          challengeDraftRef.current = draft;
          setCreatedItem(null);
          finish(answer);
        });
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
        void discussGoal(q, ctx, goalDraftRef.current).then(({ reply: answer, draft }) => {
          if (gen !== replyGen.current) return;
          setGoalDraft(draft);
          goalDraftRef.current = draft;
          setCreatedItem(null);
          finish(answer);
        });
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
        void discussSchedule(q, ctx, scheduleDraftRef.current).then(({ reply: answer, draft }) => {
          if (gen !== replyGen.current) return;
          setScheduleDraft(draft);
          scheduleDraftRef.current = draft;
          setCreatedItem(null);
          finish(answer);
        });
        return;
      }

      void jarvisAnswer(q, ctx).then(finish);
    },
    [authorizeChallenge, authorizeGoal, authorizeSchedule, location.search, navigate, session, speakAnswer],
  );

  const startListen = useCallback(() => {
    const rec = createSpeechRecognition();
    if (!rec) {
      setMicHint("Este aparelho não reconhece voz. Digita aí no chat.");
      setMode("idle");
      return;
    }
    setMicHint(null);
    stopSpeaking();
    setMode("listening");
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
      if (interim) setDraftText(interim);
      if (finalText.trim()) setDraftText(finalText.trim());
    };
    rec.onerror = () => {
      setMode("idle");
      setMicHint("Não te ouvi. Toca de novo no botão de voz.");
    };
    rec.onend = () => {
      setMode("idle");
      const said = finalText.trim();
      if (said) reply(said);
      else if (voiceOpenRef.current) {
        // silêncio — espera o usuário falar de novo ou fechar
      }
    };
    try {
      rec.start();
    } catch {
      setMode("idle");
      setMicHint("Microfone ocupado. Fecha outros apps e tenta de novo.");
    }
  }, [reply]);
  listenAgainRef.current = startListen;

  const openVoice = useCallback(() => {
    if (!speechRecognitionSupported()) {
      setMicHint("Voz não roda neste aparelho — usa o chat escrito.");
      return;
    }
    setVoiceOpen(true);
    stopSpeaking();
    setMode("idle");
    window.setTimeout(() => startListen(), 350);
  }, [startListen]);

  const closeVoice = useCallback(() => {
    setVoiceOpen(false);
    stopSpeaking();
    cancelSpeakRef.current?.();
    setMode("idle");
  }, []);

  useEffect(() => {
    return () => {
      cancelSpeakRef.current?.();
      stopSpeaking();
    };
  }, []);

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
