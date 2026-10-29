import { Link } from "react-router-dom";
import { Avatar, Dropdown } from "@/components/ui";
import { validateChallengeForm } from "@/data/wedash/challengeForm";
import { ChallengeProposalCard } from "@/components/wedash/jarvis/ChallengeProposalCard";
import { GoalProposalCard } from "@/components/wedash/jarvis/GoalProposalCard";
import { ScheduleProposalCard } from "@/components/wedash/jarvis/ScheduleProposalCard";
import {
  challengeDraftReady,
  missingChallengeLabels,
} from "@/components/wedash/jarvis/challengeDraft";
import {
  goalDraftReady,
  missingGoalLabels,
  validateGoalDraft,
} from "@/components/wedash/jarvis/goalDraft";
import {
  missingScheduleLabels,
  scheduleDraftReady,
  validateScheduleDraft,
} from "@/components/wedash/jarvis/scheduleDraft";
import { dayGreeting, firstNameFrom } from "@/components/wedash/jarvis/greeting";
import { JarvisHubBackdrop } from "@/components/wedash/jarvis/JarvisHubBackdrop";
import { useJarvis } from "@/components/wedash/jarvis/JarvisProvider";
import { cn } from "@/lib/cn";
import { paths } from "@/router/paths";
import { useSession } from "@/session/SessionProvider";
import { MoreIcon, SendIcon } from "@/pages/apps/icons";

function voiceCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(
    navigator.mediaDevices?.getUserMedia || w.SpeechRecognition || w.webkitSpeechRecognition,
  );
}

/** Hub JARVIS — estilo Néctar: saudação, esfera, composer central (não é chat Slack). */
export function JarvisPage() {
  const j = useJarvis();
  const { session } = useSession();

  if (!j.allowed) {
    return (
      <div className="rounded-[18px] border border-line bg-bg-2 p-8 text-center">
        <p className="text-[15px] font-bold text-t0">Chat IA</p>
        <p className="mt-2 text-[13px] text-t2">Disponível só na visão Gestor.</p>
      </div>
    );
  }

  const empty =
    j.messages.length === 0 &&
    !j.challengeDraft &&
    !j.goalDraft &&
    !j.scheduleDraft &&
    !j.createdItem &&
    j.mode === "idle";
  const name = firstNameFrom(session?.name ?? "");
  const hello = dayGreeting();
  const busy = j.mode === "listening" || j.mode === "thinking" || j.mode === "speaking";

  return (
    <div className="relative flex h-[calc(100vh-120px)] min-h-[560px] flex-col overflow-hidden rounded-[22px] border border-line/60 bg-bg-0 shadow-[var(--shadow-vela)]">
      <JarvisHubBackdrop />

      <div className="relative z-10 flex items-center justify-end px-4 py-3 sm:px-5">
        <Dropdown
          align="right"
          trigger={
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line/70 bg-bg-2/50 text-t1 backdrop-blur-sm hover:bg-bg-3 hover:text-t0"
              aria-label="Mais opções"
            >
              <MoreIcon size={16} />
            </button>
          }
          items={[
            {
              label: "Limpar conversa",
              onClick: j.clearChat,
              disabled: empty,
            },
          ]}
        />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center px-4 pb-5 sm:px-8">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-t2">{hello}</p>
            <h1 className="mt-2 text-[clamp(2.4rem,6vw,3.6rem)] font-light leading-none tracking-tight text-t0">
              {name}
            </h1>
            <Link
              to={paths.overview}
              className="mt-5 inline-flex items-center rounded-full border border-acc/50 bg-acc/10 px-3.5 py-1.5 text-[12px] font-semibold text-acc hover:bg-acc/20"
            >
              ver visão geral
            </Link>
          </div>
        ) : (
          <div className="mb-4 w-full max-w-2xl flex-1 overflow-y-auto pt-2">
            <div className="flex flex-col gap-4">
              {j.messages.map((m, i) => (
                <div key={i} className={cn("flex gap-2.5", m.from === "user" && "flex-row-reverse")}>
                  {m.from === "jarvis" ? <Avatar name="JARVIS" size="sm" className="mt-0.5" /> : null}
                  <div
                    className={cn(
                      "flex max-w-[85%] flex-col sm:max-w-[78%]",
                      m.from === "user" ? "items-end" : "items-start",
                    )}
                  >
                    {m.from === "jarvis" ? (
                      <span className="mb-1 text-[11.5px] font-semibold text-t2">JARVIS</span>
                    ) : null}
                    <div
                      className={cn(
                        "px-3.5 py-2.5 text-[13.5px] leading-relaxed backdrop-blur-sm",
                        m.from === "user"
                          ? "rounded-[16px_4px_16px_16px] bg-acc text-white"
                          : "rounded-[4px_16px_16px_16px] border border-line/50 bg-bg-2/70 text-t0",
                      )}
                    >
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
              {j.mode === "listening" || j.mode === "thinking" ? (
                <div className="flex gap-2.5">
                  <Avatar name="JARVIS" size="sm" className="mt-0.5" />
                  <div className="rounded-[4px_16px_16px_16px] border border-line/50 bg-bg-2/70 px-3.5 py-2.5 text-[13px] text-t2">
                    {j.mode === "listening" ? "Ouvindo…" : j.commitBusy ? "Gravando…" : "Pensando…"}
                  </div>
                </div>
              ) : null}
              <div ref={j.endRef} />
            </div>

            {j.challengeDraft ? (
              <ChallengeProposalCard
                form={j.challengeDraft.form}
                storeName={j.storeNameFor(j.challengeDraft.form.storeId)}
                ready={challengeDraftReady(j.challengeDraft.form)}
                missing={missingChallengeLabels(validateChallengeForm(j.challengeDraft.form))}
                busy={j.commitBusy}
                onAuthorize={j.authorizeChallenge}
                onDiscard={j.discardChallenge}
              />
            ) : null}
            {j.goalDraft ? (
              <GoalProposalCard
                form={j.goalDraft.form}
                storeName={j.storeNameFor(j.goalDraft.form.storeId)}
                ready={goalDraftReady(j.goalDraft.form)}
                missing={missingGoalLabels(validateGoalDraft(j.goalDraft.form))}
                busy={j.commitBusy}
                onAuthorize={j.authorizeGoal}
                onDiscard={j.discardGoal}
              />
            ) : null}
            {j.scheduleDraft ? (
              <ScheduleProposalCard
                form={j.scheduleDraft.form}
                storeName={j.scheduleDraft.storeName}
                ready={scheduleDraftReady(j.scheduleDraft.form)}
                missing={missingScheduleLabels(validateScheduleDraft(j.scheduleDraft.form))}
                busy={j.commitBusy}
                onAuthorize={j.authorizeSchedule}
                onDiscard={j.discardSchedule}
              />
            ) : null}
            {j.createdItem ? (
              <div className="mt-3 rounded-[14px] border border-ok/30 bg-ok-soft/40 px-3.5 py-3 text-[13px]">
                <p className="font-semibold text-t0">
                  {j.createdItem.kind === "goal"
                    ? `Meta criada: ${j.createdItem.name}`
                    : j.createdItem.kind === "challenge"
                      ? `Desafio criado: ${j.createdItem.name}`
                      : `Escala gerada: ${j.createdItem.name}`}
                </p>
                <Link
                  to={
                    j.createdItem.kind === "goal"
                      ? paths.goalDetail(j.createdItem.id)
                      : j.createdItem.kind === "challenge"
                        ? paths.management.challengeDetail(j.createdItem.id)
                        : paths.management.schedule
                  }
                  className="mt-1 inline-block font-bold text-acc hover:underline"
                >
                  Abrir{" "}
                  {j.createdItem.kind === "goal"
                    ? "meta"
                    : j.createdItem.kind === "challenge"
                      ? "desafio"
                      : "escala"}
                </Link>
              </div>
            ) : null}
          </div>
        )}

        <div className={cn("w-full max-w-2xl", empty ? "mt-2 mb-10" : "mt-auto")}>
          {j.micHint ? <p className="mb-2 text-center text-[12px] text-t2">{j.micHint}</p> : null}
          <div className="rounded-2xl border border-line/70 bg-bg-2/75 p-3 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.55)] backdrop-blur-md">
            <input
              value={j.draftText}
              onChange={(e) => j.setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") j.reply(j.draftText);
              }}
              placeholder="Como posso te ajudar?"
              disabled={j.mode === "listening"}
              className="h-11 w-full bg-transparent px-2 text-[15px] text-t0 outline-none placeholder:text-t2 disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-2 px-1">
              <span className="hidden text-[11px] text-t2 sm:inline">Texto ou microfone · JARVIS só grava com Autorizar</span>
              <div className="ml-auto flex items-center gap-1.5">
                {voiceCaptureSupported() ? (
                  <button
                    type="button"
                    onClick={() => j.openVoice({ source: "button" })}
                    disabled={busy}
                    aria-label="Usar microfone"
                    title="Usar microfone (pede permissão no clique)"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-t1 hover:border-acc hover:text-acc disabled:opacity-50"
                  >
                    <MicIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => j.reply(j.draftText)}
                  disabled={!j.draftText.trim() || j.mode === "listening" || j.mode === "thinking"}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-acc px-4 text-[13px] font-bold text-white hover:bg-acc-2 disabled:opacity-50"
                  aria-label="Enviar"
                >
                  <SendIcon size={16} />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default JarvisPage;
