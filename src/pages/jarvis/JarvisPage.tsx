import { Link } from "react-router-dom";
import { Avatar } from "@/components/ui";
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
import { padBottom } from "@/lib/safeArea";
import { paths } from "@/router/paths";
import { useSession } from "@/session/SessionProvider";
import { SendIcon } from "@/pages/apps/icons";

function voiceCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(
    navigator.mediaDevices?.getUserMedia || w.SpeechRecognition || w.webkitSpeechRecognition,
  );
}

/** Hub JARVIS — full-bleed no miolo (sem card), estilo Néctar. */
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
    j.mode === "idle" &&
    !j.voiceOpen;
  const name = firstNameFrom(session?.name ?? "");
  const hello = dayGreeting();
  const busy = j.mode === "listening" || j.mode === "thinking" || j.mode === "speaking";
  const voiceStatus =
    j.mode === "listening"
      ? "OUVINDO…"
      : j.mode === "thinking"
        ? "PENSANDO…"
        : j.mode === "speaking"
          ? "FALANDO…"
          : "PRONTO";

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-0">
      <JarvisHubBackdrop />

      <div
        className="pad-base relative z-10 flex min-h-0 flex-1 flex-col items-center px-3 pt-2 sm:px-6 sm:pt-4"
        style={padBottom("0px")}
      >
        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 text-center">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-acc">{hello}</p>
            <h1 className="mt-2 max-w-full truncate text-[clamp(2rem,9vw,3.6rem)] font-light leading-none tracking-tight text-t0">
              {name}
            </h1>
          </div>
        ) : (
          <div className="mb-3 w-full max-w-2xl min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1">
            <div className="flex flex-col gap-3 sm:gap-4">
              {j.messages.map((m, i) => (
                <div key={i} className={cn("flex gap-2.5", m.from === "user" && "flex-row-reverse")}>
                  {m.from === "jarvis" ? (
                    <Avatar name="JARVIS" size="sm" className="mt-0.5 hidden sm:block" />
                  ) : null}
                  <div
                    className={cn(
                      "flex max-w-[92%] flex-col sm:max-w-[78%]",
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
              {!j.voiceOpen && (j.mode === "listening" || j.mode === "thinking") ? (
                <div className="flex gap-2.5">
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

        <div className={cn("w-full max-w-2xl shrink-0", empty ? "mt-4 mb-0 sm:mb-2" : "mt-auto")}>
          {j.micHint && !j.dictating && !j.voiceOpen ? (
            <p className="mb-2 text-center text-[12px] text-t2">{j.micHint}</p>
          ) : null}

          {j.dictating ? (
            <div className="flex flex-col items-center gap-3 py-1">
              <div className="flex h-12 w-full max-w-md items-center justify-center gap-[3px] rounded-full border border-line/60 bg-bg-2/80 px-4 backdrop-blur-md">
                {j.dictateLevels.map((lvl, i) => (
                  <span
                    key={i}
                    className="w-[3px] shrink-0 rounded-full bg-acc transition-[height] duration-75"
                    style={{ height: `${Math.max(4, Math.round(4 + lvl * 28))}px` }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-t1">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />
                  {j.dictateBusy ? "Transcrevendo…" : `REC ${formatRecTime(j.dictateSeconds)}`}
                </span>
                <button
                  type="button"
                  onClick={j.cancelDictate}
                  disabled={j.dictateBusy}
                  aria-label="Cancelar gravação"
                  title="Cancelar"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-t2 hover:bg-bg-3 hover:text-t0 disabled:opacity-50"
                >
                  <CloseIcon />
                </button>
                <button
                  type="button"
                  onClick={j.finishDictate}
                  disabled={j.dictateBusy}
                  aria-label="Parar e transcrever"
                  title="Parar e transcrever"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-bg-2 text-bad hover:bg-bg-3 disabled:opacity-50"
                >
                  <StopIcon />
                </button>
              </div>
            </div>
          ) : j.voiceOpen ? (
            <div className="flex flex-col items-center gap-3 py-1">
              <div className="flex h-14 w-full max-w-lg items-center justify-center gap-[3px] px-2">
                {j.voiceLevels.map((lvl, i) => (
                  <span
                    key={i}
                    className="w-[3px] shrink-0 rounded-full bg-acc/90 transition-[height] duration-75"
                    style={{
                      height: `${Math.max(4, Math.round(4 + lvl * 36))}px`,
                      opacity:
                        j.voicePaused
                          ? 0.3
                          : j.mode === "listening" || j.mode === "speaking"
                            ? 0.85 + lvl * 0.15
                            : 0.45,
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <span className="text-[11px] font-semibold tracking-[0.28em] text-acc">
                  {j.voicePaused ? "ÁUDIO PAUSADO" : voiceStatus}
                </span>
                {j.micHint ? <span className="max-w-[12rem] text-[11px] text-warn">{j.micHint}</span> : null}
                {j.voicePaused ? (
                  <button
                    type="button"
                    onClick={j.resumeVoice}
                    className="rounded-full border border-acc/50 px-3 py-1.5 text-[12px] font-semibold text-acc hover:bg-acc/10"
                  >
                    Retomar voz
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={j.closeVoice}
                  aria-label="Encerrar conversa por voz"
                  title="Encerrar"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-t2 hover:bg-bg-3 hover:text-t0"
                >
                  <CloseIcon />
                </button>
                {!j.voicePaused ? (
                  <button
                    type="button"
                    onClick={() => j.finishVoice()}
                    disabled={j.mode === "thinking" || j.mode === "speaking"}
                    aria-label={j.mode === "listening" ? "Enviar agora" : "Continuar ouvindo"}
                    title={j.mode === "listening" ? "Enviar agora" : "Continuar"}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-acc hover:bg-acc/10 disabled:opacity-40"
                  >
                    <MicIcon />
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-line/70 bg-bg-2/80 p-2.5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-3">
              <input
                value={j.draftText}
                onChange={(e) => j.setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") j.reply(j.draftText);
                }}
                placeholder="Como posso te ajudar?"
                className="h-10 w-full bg-transparent px-2 text-[15px] text-t0 outline-none placeholder:text-t2 sm:h-11"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 sm:mt-2">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={j.toggleVoiceRead}
                    aria-pressed={j.voiceRead}
                    aria-label={j.voiceRead ? "Leitura em voz ligada" : "Leitura em voz desligada"}
                    title={j.voiceRead ? "Leitura em voz: ligada" : "Leitura em voz: desligada"}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                      j.voiceRead ? "text-acc" : "text-t2 hover:text-t1",
                    )}
                  >
                    <SpeakerIcon />
                  </button>
                  {voiceCaptureSupported() ? (
                    <>
                      <button
                        type="button"
                        onClick={() => j.openVoice({ source: "button" })}
                        disabled={busy}
                        aria-label="Conversar por voz"
                        title="Conversar por voz"
                        className="flex h-10 w-10 items-center justify-center rounded-full text-t2 hover:text-acc disabled:opacity-50"
                      >
                        <WaveIcon />
                      </button>
                      <button
                        type="button"
                        onClick={j.startDictate}
                        disabled={busy}
                        aria-label="Falar e transcrever"
                        title="Microfone: gravar e transcrever no texto"
                        className="flex h-10 w-10 items-center justify-center rounded-full text-t2 hover:text-acc disabled:opacity-50"
                      >
                        <MicIcon />
                      </button>
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => j.reply(j.draftText)}
                  disabled={!j.draftText.trim() || j.mode === "thinking"}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-acc px-3.5 text-[13px] font-bold text-white hover:bg-acc-2 disabled:opacity-50 sm:px-4"
                  aria-label="Enviar"
                >
                  <SendIcon size={16} />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRecTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SpeakerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
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
