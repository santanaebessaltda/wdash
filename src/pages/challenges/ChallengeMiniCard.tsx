import { Badge, ProgressBar } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import type { ChallengeRecord } from "@/data/wedash/challengesRepo";
import { CHALLENGE_STATUS_LABEL, metricValueLabel, type ChallengeView } from "@/data/wedash/challengeView";
import { cn } from "@/lib/cn";
import { num, shortDate } from "@/lib/format";
import { statusBadgeVariant } from "@/lib/status";
import { challengeHeadline, floorChallengeHeadline, HeadlineText, mainPrizeLabel } from "@/pages/challenges/shared";
import { FlameIcon, TrophyIcon } from "@/pages/dashboards/icons";

/** Desafio na aba Desafios da Equipe: so leitura, clique abre o detalhe. */
export function ChallengeMiniCard({
  challenge: c,
  view,
  storeNameValue,
  onOpen,
  prominent = false,
  showPeople = false,
  hotKey = null,
  floor = false,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  storeNameValue?: string;
  /** Sem isto o card fica só leitura, como no placar da loja. */
  onOpen?: () => void;
  /** Mesmo ícone e tamanho do card de desafio da Gestão. */
  prominent?: boolean;
  /** Lista o resultado de cada pessoa, como no detalhe do desafio. */
  showPeople?: boolean;
  hotKey?: string | null;
  /** Texto corrido, para o placar da loja. */
  floor?: boolean;
}) {
  const destaque = floor ? floorChallengeHeadline(c, view) : challengeHeadline(c, view);
  const prize = mainPrizeLabel(c);
  const ended = view.status === "ended";
  const statusLabel = CHALLENGE_STATUS_LABEL[view.status];
  const disputa = c.mode === "CONTEST";
  const leader = Math.max(0, ...view.participants.map((person) => person.result ?? 0));
  const TextTag = showPeople ? "div" : "span";
  const className = cn(
    "flex w-full items-start gap-3.5 border border-line text-left",
    prominent ? "rounded-2xl p-5 shadow-[var(--shadow-vela)]" : "rounded-xl p-4",
    ended ? "bg-bg-inset" : "bg-bg-2",
    onOpen && "cursor-pointer transition-colors hover:border-line-2 focus-visible:border-acc focus-visible:outline-none",
  );
  const body = (
    <>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          prominent ? "h-[50px] w-[50px] rounded-[14px]" : "h-10 w-10 rounded-xl",
          ended ? "bg-bg-3 text-t2" : "bg-acc-soft text-acc",
        )}
      >
        <FlameIcon size={prominent ? 22 : 18} />
      </span>
      <TextTag className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={cn("min-w-0 truncate font-bold text-t0", prominent ? "text-[15px]" : "text-[14px]")}>{c.name}</span>
          <Badge variant={statusBadgeVariant(statusLabel)} className="shrink-0 uppercase">
            {statusLabel}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-t2">
          {shortDate(c.startsOn)} a {shortDate(c.endsOn)}
          {!ended ? ` · ${view.prazo}` : ""}
        </span>
        {storeNameValue ? <StoreDivisionTitle className="mt-1.5">{storeNameValue}</StoreDivisionTitle> : null}
        <span className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-[13px] text-t1">
            <HeadlineText headline={destaque} />
          </span>
          {prize && (
            <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-t1">
              <TrophyIcon size={13} className="text-warn" />
              {prize}
            </span>
          )}
        </span>
        {showPeople && (
          <ul className="mt-3 space-y-2.5 border-t border-line pt-3">
            {view.participants.length === 0 ? (
              <li className="py-2 text-[12.5px] text-t2">Nenhuma pessoa no desafio.</li>
            ) : (
              view.participants.map((person) => {
                const pct = challengeProgress(person.result, c.target, leader);
                return (
                  <li key={person.key} className={cn("flex items-center gap-2", hotKey === person.key && "rounded-lg bg-acc-soft px-1")}>
                    {disputa && (
                      <span className="w-6 shrink-0 text-[12px] font-extrabold text-t2">
                        {person.position == null ? "—" : `${person.position}º`}
                      </span>
                    )}
                    <PersonAvatar name={person.name} employeeId={person.key} storeId={c.storeId} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-[13px] font-semibold text-t0">{person.name}</span>
                        <span className="shrink-0 font-mono text-[12px] font-bold text-t0">
                          {person.result == null ? "—" : metricValueLabel(c.metric, person.result)}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <ProgressBar value={pct} height={5} color={person.winner ? "var(--ok)" : undefined} />
                        </span>
                        {person.winner ? (
                          <Badge variant="success" className="shrink-0">
                            {person.position != null ? `${person.position}º lugar` : "Atingiu"}
                          </Badge>
                        ) : (
                          <span className="w-9 shrink-0 text-right font-mono text-[11px] font-bold text-t2">{num(pct, 0)}%</span>
                        )}
                      </span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </TextTag>
    </>
  );
  if (!onOpen) return <div className={className}>{body}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={`Ver detalhe do desafio ${c.name}`} className={className}>
      {body}
    </button>
  );
}

/** Barra até a meta. Na disputa sem meta, a barra vai até quem está na frente. */
function challengeProgress(result: number | null, target: number | null, leader: number): number {
  if (result == null || result <= 0) return 0;
  const goal = target != null && target > 0 ? target : leader;
  if (goal <= 0) return 0;
  return Math.min(100, (result / goal) * 100);
}
