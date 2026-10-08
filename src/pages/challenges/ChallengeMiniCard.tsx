import type { ChallengeRecord } from "@/data/wedash/challengesRepo";
import type { ChallengeView } from "@/data/wedash/challengeView";
import { dataCurta } from "@/lib/format";
import { challengeHeadline, HeadlineText, mainPrizeLabel } from "@/pages/challenges/shared";
import { FlameIcon, TrophyIcon } from "@/pages/dashboards/icons";

/** Desafio em andamento na aba Desafios da Equipe: so leitura, clique abre o detalhe. */
export function ChallengeMiniCard({
  challenge: c,
  view,
  lojaNome,
  onOpen,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  lojaNome?: string;
  onOpen: () => void;
}) {
  const destaque = challengeHeadline(c, view);
  const premio = mainPrizeLabel(c);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Ver detalhe do desafio ${c.name}`}
      className="flex w-full cursor-pointer items-start gap-3.5 rounded-xl border border-line bg-bg-2 p-4 text-left transition-colors hover:border-line-2 focus-visible:border-acc focus-visible:outline-none"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acc-soft text-acc">
        <FlameIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="truncate text-[14px] font-bold text-t0">{c.name}</span>
          <span className="shrink-0 text-[11.5px] font-semibold text-t2">{view.prazo}</span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-t2">
          {dataCurta(c.startsOn)} a {dataCurta(c.endsOn)}
          {lojaNome ? ` · ${lojaNome}` : ""}
        </span>
        <span className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-[13px] text-t1">
            <HeadlineText headline={destaque} />
          </span>
          {premio && (
            <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-t1">
              <TrophyIcon size={13} className="text-warn" />
              {premio}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
