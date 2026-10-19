import { Badge } from "@/components/ui";
import type { ChallengeRecord } from "@/data/wedash/challengesRepo";
import { CHALLENGE_STATUS_LABEL, type ChallengeView } from "@/data/wedash/challengeView";
import { cn } from "@/lib/cn";
import { shortDate } from "@/lib/format";
import { statusBadgeVariant } from "@/lib/status";
import { challengeHeadline, HeadlineText, mainPrizeLabel } from "@/pages/challenges/shared";
import { FlameIcon, TrophyIcon } from "@/pages/dashboards/icons";

/** Desafio na aba Desafios da Equipe: so leitura, clique abre o detalhe. */
export function ChallengeMiniCard({
  challenge: c,
  view,
  storeNameValue,
  onOpen,
  prominent = false,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  storeNameValue?: string;
  /** Sem isto o card fica só leitura, como no placar da loja. */
  onOpen?: () => void;
  /** Mesmo ícone e tamanho do card de desafio da Gestão. */
  prominent?: boolean;
}) {
  const destaque = challengeHeadline(c, view);
  const prize = mainPrizeLabel(c);
  const ended = view.status === "ended";
  const statusLabel = CHALLENGE_STATUS_LABEL[view.status];
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
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={cn("min-w-0 truncate font-bold text-t0", prominent ? "text-[15px]" : "text-[14px]")}>{c.name}</span>
          <Badge variant={statusBadgeVariant(statusLabel)} className="shrink-0 uppercase">
            {statusLabel}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-t2">
          {shortDate(c.startsOn)} a {shortDate(c.endsOn)}
          {!ended ? ` · ${view.prazo}` : ""}
          {storeNameValue ? ` · ${storeNameValue}` : ""}
        </span>
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
      </span>
    </>
  );
  if (!onOpen) return <div className={className}>{body}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={`Ver detalhe do desafio ${c.name}`} className={className}>
      {body}
    </button>
  );
}
