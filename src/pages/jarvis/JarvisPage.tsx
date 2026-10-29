import { Link } from "react-router-dom";
import { Avatar, Button } from "@/components/ui";
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
import { SUGGESTIONS, useJarvis } from "@/components/wedash/jarvis/JarvisProvider";
import { speechRecognitionSupported } from "@/components/wedash/jarvis/speech";
import { cn } from "@/lib/cn";
import { paths } from "@/router/paths";

/** Chat JARVIS — casca no espírito do Chat Vela + botão de voz (Néctar / ChatGPT). */
export function JarvisPage() {
  const j = useJarvis();

  if (!j.allowed) {
    return (
      <div className="rounded-[18px] border border-line bg-bg-2 p-8 text-center">
        <p className="text-[15px] font-bold text-t0">JARVIS</p>
        <p className="mt-2 text-[13px] text-t2">Disponível só na visão Gestor.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-130px)] min-h-[520px] flex-col overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <Avatar name="JARVIS" size="md" status="online" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-t0">JARVIS</p>
          <p className="mt-0.5 text-xs text-ok">Online · seu sócio na operação</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-4">
          {j.messages.map((m, i) => (
            <div key={i} className={cn("flex gap-2.5", m.from === "user" && "flex-row-reverse")}>
              {m.from === "jarvis" ? <Avatar name="JARVIS" size="sm" className="mt-0.5" /> : null}
              <div className={cn("flex max-w-[75%] flex-col sm:max-w-[68%]", m.from === "user" ? "items-end" : "items-start")}>
                {m.from === "jarvis" ? <span className="mb-1 text-[11.5px] font-semibold text-t2">JARVIS</span> : null}
                <div
                  className={cn(
                    "px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                    m.from === "user"
                      ? "rounded-[16px_4px_16px_16px] bg-acc text-white"
                      : "rounded-[4px_16px_16px_16px] bg-bg-3 text-t0",
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
              <div className="rounded-[4px_16px_16px_16px] bg-bg-3 px-3.5 py-2.5 text-[13px] text-t2">
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
              {j.createdItem.kind === "goal" ? "meta" : j.createdItem.kind === "challenge" ? "desafio" : "escala"}
            </Link>
          </div>
        ) : null}

        {j.messages.length <= 1 ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {SUGGESTIONS.map((s) => (
              <Button key={s} size="sm" variant="secondary" onClick={() => j.reply(s)}>
                {s}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-line px-5 py-3.5">
        {j.micHint ? <p className="mb-2 text-[12px] text-t2">{j.micHint}</p> : null}
        <div className="flex items-center gap-2">
          <input
            value={j.draftText}
            onChange={(e) => j.setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") j.reply(j.draftText);
            }}
            placeholder="Converse com o JARVIS…"
            disabled={j.mode === "listening"}
            className="h-[42px] flex-1 rounded-xl border border-line bg-bg-inset px-3.5 text-[13.5px] text-t0 outline-none placeholder:text-t2 focus:border-acc"
          />
          {speechRecognitionSupported() ? (
            <button
              type="button"
              onClick={() => j.openVoice()}
              disabled={j.mode === "listening" || j.mode === "thinking" || j.mode === "speaking"}
              aria-label="Conversar por voz"
              title="Conversar por voz"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-line text-t1 hover:bg-bg-3 hover:text-acc disabled:opacity-50"
            >
              <WaveIcon />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => j.reply(j.draftText)}
            disabled={!j.draftText.trim() || j.mode === "listening" || j.mode === "thinking"}
            className="flex h-[42px] shrink-0 items-center justify-center rounded-xl bg-acc px-3.5 text-white hover:bg-acc-2 disabled:opacity-50"
            aria-label="Enviar"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function WaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default JarvisPage;
