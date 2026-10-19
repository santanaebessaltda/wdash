import { useState } from "react";
import { Badge, ProgressBar } from "@/components/ui";
import { prazoRemaining } from "@/data/wedash/engine/goalView";
import type { SellerChallenge } from "@/data/wedash/engine/sellerHome";
import { cn } from "@/lib/cn";
import { isoToDate, shortDate } from "@/lib/format";
import { statusBadgeVariant } from "@/lib/status";
import { HeadlineText, type ChallengeHeadline } from "@/pages/challenges/shared";
import { FlameIcon, TrophyIcon } from "@/pages/dashboards/icons";

const STATUS_LABEL = { active: "Em andamento", upcoming: "A começar", ended: "Encerrado" } as const;
const SECTION = { active: "Em andamento", upcoming: "A começar", ended: "Encerrados" } as const;

function daysLeft(today: string, endsOn: string): number {
  return Math.round((isoToDate(endsOn).getTime() - isoToDate(today).getTime()) / 86_400_000) + 1;
}

function shownStatus(c: SellerChallenge, closed: boolean, through: string): SellerChallenge["status"] {
  if (closed && c.status !== "upcoming" && c.endsOn <= through) return "ended";
  return c.status;
}

function sellerHeadline(c: SellerChallenge, status: SellerChallenge["status"]): ChallengeHeadline {
  if (status === "upcoming") return { label: "Critério", value: c.metricLabel };
  if (c.unavailable) return { label: null, value: "Resultado indisponível" };
  if (c.won && c.position == null) return { label: null, value: "Você atingiu o mínimo" };
  if (c.position != null) {
    const result = c.result ? ` · ${c.result}` : "";
    return { label: status === "ended" ? "Você ficou" : "Você está", value: `${c.position}º lugar${result}` };
  }
  if (c.result) return { label: c.metricLabel, value: c.result };
  return { label: null, value: "Sem resultado ainda" };
}

function SellerChallengeCard({
  challenge: c,
  today,
  through,
  closed,
}: {
  challenge: SellerChallenge;
  today: string;
  through: string;
  closed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = shownStatus(c, closed, through);
  const ended = status === "ended";
  const clock = closed ? through : today;
  const prazo = status === "active" ? prazoRemaining(daysLeft(clock, c.endsOn)) : null;
  return (
    <div className={cn("flex items-start gap-3.5 rounded-xl border border-line p-4", ended ? "bg-bg-inset" : "bg-bg-2")}>
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          ended ? "bg-bg-3 text-t2" : "bg-acc-soft text-acc",
        )}
      >
        <FlameIcon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[14px] font-bold text-t0">{c.name}</p>
          <Badge variant={statusBadgeVariant(STATUS_LABEL[status])} className="shrink-0 uppercase">
            {STATUS_LABEL[status]}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-t2">
          {shortDate(c.startsOn)} a {shortDate(c.endsOn)}
          {prazo ? ` · ${prazo}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-[13px] text-t1">
            <HeadlineText headline={sellerHeadline(c, status)} />
          </p>
          {c.prize && (
            <p className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-t1">
              <TrophyIcon size={13} className="text-warn" />
              {c.prize}
            </p>
          )}
        </div>
        {status !== "upcoming" && c.progressPct != null && (
          <div className="mt-2.5">
            <ProgressBar value={c.progressPct} color={c.won ? "var(--ok)" : "var(--acc)"} height={6} />
          </div>
        )}
        {status === "upcoming" ? (
          <p className="mt-2 text-[12.5px] text-t2">Os resultados aparecerão quando o desafio começar.</p>
        ) : c.unavailable ? (
          <p className="mt-2 text-[12.5px] text-t2">Faltam dados de itens em pelo menos um dia com vendas.</p>
        ) : (
          c.gap && <p className="mt-2 text-[12.5px] font-semibold text-t1">{c.gap}</p>
        )}
        {c.rules.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              className="text-[12px] font-semibold text-t2 hover:text-t1"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Ocultar como funciona" : "Como funciona"}
            </button>
            {open && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {c.rules.map((rule) => (
                  <li key={rule} className="text-[12.5px] leading-snug text-t1">
                    {rule}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Desafios da pessoa, no desenho do card da Equipe, agrupados pelo estado. */
export function SellerChallengeList({
  challenges,
  today,
  through,
  closed,
}: {
  challenges: SellerChallenge[];
  today: string;
  through: string;
  closed: boolean;
}) {
  const present = (["active", "upcoming", "ended"] as const).filter((status) =>
    challenges.some((c) => shownStatus(c, closed, through) === status),
  );
  const split = present.length > 1;
  return (
    <div className="flex flex-col gap-4">
      {present.map((status) => (
        <div key={status}>
          {split && <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-t2">{SECTION[status]}</p>}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {challenges
              .filter((c) => shownStatus(c, closed, through) === status)
              .map((c) => (
                <SellerChallengeCard key={c.id} challenge={c} today={today} through={through} closed={closed} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
