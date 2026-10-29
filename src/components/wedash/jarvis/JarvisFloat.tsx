import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/ui";
import { validateChallengeForm } from "@/data/wedash/challengeForm";
import { cn } from "@/lib/cn";
import { padBottom } from "@/lib/safeArea";
import { paths } from "@/router/paths";
import { SendIcon } from "@/pages/apps/icons";
import { ChallengeProposalCard } from "./ChallengeProposalCard";
import { GoalProposalCard } from "./GoalProposalCard";
import { ScheduleProposalCard } from "./ScheduleProposalCard";
import {
  challengeDraftReady,
  missingChallengeLabels,
} from "./challengeDraft";
import { goalDraftReady, missingGoalLabels, validateGoalDraft } from "./goalDraft";
import {
  missingScheduleLabels,
  scheduleDraftReady,
  validateScheduleDraft,
} from "./scheduleDraft";
import { useJarvis } from "./JarvisProvider";

function micSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Chat IA flutuante (estilo thread do Apps > Chat do Vela).
 * Só Gestor — botão no canto inferior direito.
 */
export function JarvisFloat() {
  const j = useJarvis();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!j.allowed) return null;

  const busy = j.mode === "thinking" || j.dictating || j.dictateBusy;
  const empty =
    j.messages.length === 0 &&
    !j.challengeDraft &&
    !j.goalDraft &&
    !j.scheduleDraft &&
    !j.createdItem &&
    j.mode === "idle";

  // Portal no body: o shell é position:fixed + overflow hidden; FAB no miolo some da tela.
  return createPortal(
    <div
      className="pad-base fixed bottom-0 right-0 z-[80] flex flex-col items-end gap-3 p-4 print:hidden sm:right-2 sm:p-6"
      style={padBottom("1rem")}
    >
        {open ? (
          <div
            className={cn(
              "flex w-[min(100vw-2rem,400px)] flex-col overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]",
              "h-[min(70vh,640px)] min-h-[420px]",
            )}
            role="dialog"
            aria-label="Chat IA"
          >
            {/* Cabeçalho — mesmo padrão do Apps > Chat */}
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5">
              <Avatar name="JARVIS" size="md" status="online" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-t0">JARVIS</p>
                <p className="mt-0.5 text-xs text-ok">Online · Chat IA</p>
              </div>
              <button
                type="button"
                onClick={j.clearChat}
                disabled={busy || empty}
                className="rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold text-t2 hover:bg-bg-3 hover:text-t0 disabled:opacity-40"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar chat"
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 hover:text-t0"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Thread */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {empty ? (
                <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                  <Avatar name="JARVIS" size="xl" className="mb-3" />
                  <p className="text-sm font-bold text-t0">Como posso te ajudar?</p>
                  <p className="mt-1.5 text-[12.5px] text-t2">
                    Vendas, meta, desafio, escala — tudo aqui no chat.
                  </p>
                </div>
              ) : (
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
                  {j.mode === "thinking" ? (
                    <div className="flex gap-2.5">
                      <Avatar name="JARVIS" size="sm" className="mt-0.5" />
                      <div className="rounded-[4px_16px_16px_16px] bg-bg-3 px-3.5 py-2.5 text-[13px] text-t2">
                        {j.commitBusy ? "Gravando…" : "Pensando…"}
                      </div>
                    </div>
                  ) : null}

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
                    <div className="rounded-[14px] border border-ok/30 bg-ok-soft/40 px-3.5 py-3 text-[13px]">
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
                        onClick={() => setOpen(false)}
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
                  <div ref={j.endRef} />
                </div>
              )}
            </div>

            {/* Composer — Apps > Chat + mic de ditado */}
            <div className="shrink-0 border-t border-line px-3 py-3 sm:px-4">
              {j.micHint && !j.dictating ? (
                <p className="mb-2 text-center text-[11.5px] text-t2">{j.micHint}</p>
              ) : null}

              {j.dictating ? (
                <div className="flex flex-col items-center gap-2.5 py-1">
                  <div className="flex h-11 w-full items-center justify-center gap-[3px] rounded-xl border border-line bg-bg-inset px-3">
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
                      className="rounded-lg px-2 py-1 text-[12px] font-semibold text-t2 hover:bg-bg-3 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={j.finishDictate}
                      disabled={j.dictateBusy}
                      className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-bad hover:bg-bg-3 disabled:opacity-50"
                      aria-label="Parar e transcrever"
                    >
                      <StopIcon />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={j.startDictate}
                    disabled={busy || !micSupported()}
                    aria-label="Falar e transcrever"
                    title="Microfone"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 hover:text-t0 disabled:opacity-50"
                  >
                    <MicIcon />
                  </button>
                  <input
                    value={j.draftText}
                    onChange={(e) => j.setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") j.reply(j.draftText);
                    }}
                    placeholder="Digite uma mensagem…"
                    className="h-[42px] min-w-0 flex-1 rounded-xl border border-line bg-bg-inset px-3.5 text-[13.5px] text-t0 outline-none placeholder:text-t2 focus:border-acc"
                  />
                  <button
                    type="button"
                    onClick={() => j.reply(j.draftText)}
                    disabled={!j.draftText.trim() || j.mode === "thinking"}
                    className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-xl bg-acc px-3.5 text-[13px] font-bold text-white hover:bg-acc-2 disabled:opacity-50 sm:px-4"
                    aria-label="Enviar"
                  >
                    <SendIcon size={16} />
                    <span className="hidden sm:inline">Enviar</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fechar Chat IA" : "Abrir Chat IA"}
          aria-expanded={open}
          title="Chat IA"
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full bg-acc text-white shadow-[var(--shadow-vela)] transition-transform hover:bg-acc-2 hover:scale-[1.03]",
            open && "ring-2 ring-acc/30 ring-offset-2 ring-offset-bg-0",
          )}
        >
          {open ? <CloseIcon large /> : <ChatIaIcon />}
        </button>
    </div>,
    document.body,
  );
}

function formatRecTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ChatIaIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 10h.01M12 10h.01M16 10h.01"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon({ large }: { large?: boolean }) {
  const s = large ? 20 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
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
