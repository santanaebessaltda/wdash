import { Badge, EmptyState } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { brlK, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { RankingRow } from "@/data/wedash/live";
/** Medalhas do leaderboard Vela (SalesDashboard / CRM)  -  anel, trofeu e rotulos. */
const MEDALHA = {
  1: { color: "#f7b84e", glow: "0 0 32px rgba(247,184,78,0.4)" },
  2: { color: "#c7cdd6", glow: "none" },
  3: { color: "#d99a5c", glow: "none" },
} as const;

const PODIO_HEIGHT: Record<1 | 2 | 3, string> = {
  1: "h-44 sm:h-48",
  2: "h-36 sm:h-40",
  3: "h-28 sm:h-32",
};

/** Cerca de 18% mais baixo, para o placar da loja. */
const PODIO_HEIGHT_COMPACT: Record<1 | 2 | 3, string> = {
  1: "h-36 sm:h-40",
  2: "h-28 sm:h-32",
  3: "h-24 sm:h-[6.5rem]",
};

/** Ordem visual do podio: 2 | 1 | 3 */
const PODIO_ORDEM = [1, 0, 2] as const;

const MEDALHA_EMOJI: Record<2 | 3, string> = { 2: "🥈", 3: "🥉" };

function MedalhaBadge({ pos, apagada = false }: { pos: 1 | 2 | 3; apagada?: boolean }) {
  const crown = pos === 1;
  return (
    <span
      className={cn(
        "absolute leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]",
        crown ? "left-1/2 top-0 -translate-x-1/2 -translate-y-[68%] text-[30px]" : "-right-2 -top-2 text-[26px]",
        apagada && "opacity-40 grayscale",
      )}
      aria-hidden
    >
      {crown ? "👑" : MEDALHA_EMOJI[pos]}
    </span>
  );
}

/** Podio top 3  -  aba Ranking (1º com coroa, 2º e 3º com medalha; degrau na cor primaria). */
export function RankingBlock({
  ranking,
  formatAmount = brlK,
  onSelect,
  spotlight = false,
  literalName = false,
}: {
  ranking: RankingRow[];
  formatAmount?: (v: number) => string;
  onSelect?: (row: RankingRow) => void;
  /** Faturamento maior; vendas ficam em apoio. Só o placar da loja. */
  spotlight?: boolean;
  /** O nome já vem curto. Sem isto, o pódio mostra só o primeiro nome. */
  literalName?: boolean;
}) {
  if (ranking.length === 0) {
    return (
      <EmptyState
        title="Nenhuma venda no mês"
        description="Lance vendas para ver o ranking ao vivo da competência."
      />
    );
  }

  const top3 = ranking.slice(0, 3);

  return (
    <div className={cn("flex items-end justify-center gap-2.5 sm:gap-6", spotlight ? "pt-5" : "pt-7")}>
      {PODIO_ORDEM.map((i) => {
        const pos = (i + 1) as 1 | 2 | 3;
        const medal = MEDALHA[pos];
        const isOuro = pos === 1;
        const l = top3[i];
        if (!l) {
          return (
            <div
              key={`vazio-${pos}`}
              className={cn(
                "group flex flex-col items-center text-center transition-transform duration-200 hover:-translate-y-1.5",
                isOuro ? "w-[34%] max-w-[168px]" : "w-[30%] max-w-[148px]",
              )}
            >
              <div className={cn("relative transition-transform duration-200 group-hover:scale-[1.04]", spotlight ? "mb-1.5" : "mb-2.5")}>
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full border-2 border-dashed border-line text-t3",
                    isOuro ? "h-20 w-20" : "h-16 w-16",
                  )}
                >
                  —
                </span>
                <MedalhaBadge pos={pos} apagada />
              </div>
              <p className="text-[13px] font-bold text-t2 sm:text-[14px]">{pos}º lugar vago</p>
              <p className="mt-0.5 text-[11px] font-semibold text-t3">Nenhuma venda</p>
              <p className="mt-0.5 font-mono text-[13px] font-extrabold text-t3 sm:text-[14px]">—</p>
              <div
                className={cn(
                  "flex w-full items-end justify-center rounded-t-2xl transition duration-200 group-hover:brightness-125",
                  spotlight ? "mt-2" : "mt-3",
                  spotlight ? PODIO_HEIGHT_COMPACT[pos] : PODIO_HEIGHT[pos],
                )}
                style={{ background: "color-mix(in srgb, var(--acc) 16%, transparent)" }}
              >
                <span className="pb-3 text-[24px] font-extrabold leading-none text-t3 sm:text-[28px]">{pos}º</span>
              </div>
            </div>
          );
        }
        return (
          <div
            key={l.employeeId}
            {...(onSelect
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => onSelect(l),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(l);
                    }
                  },
                }
              : {})}
            className={cn(
              "group flex flex-col items-center text-center transition-transform duration-200 hover:-translate-y-1.5",
              spotlight
                ? isOuro
                  ? "w-[34%] max-w-[200px]"
                  : "w-[30%] max-w-[168px]"
                : isOuro
                  ? "w-[34%] max-w-[168px]"
                  : "w-[30%] max-w-[148px]",
              onSelect && "cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-acc",
            )}
          >
            <div className={cn("relative transition-transform duration-200 group-hover:scale-[1.04]", spotlight ? "mb-1.5" : "mb-2.5")}>
              <span
                className="relative inline-flex rounded-full"
                style={{
                  boxShadow: `0 0 0 3px ${medal.color}${isOuro ? `, ${medal.glow}` : ""}`,
                }}
              >
                <PersonAvatar size={isOuro ? "2xl" : "xl"} name={l.avatarName ?? l.name} employeeId={l.employeeId} storeId={l.storeId} />
              </span>
              <MedalhaBadge pos={pos} />
            </div>

            <p className="max-w-full truncate text-[13px] font-bold text-t0 sm:text-[14px]">
              {literalName ? l.name : l.name.split(" ")[0]}
            </p>
            {l.place ? <p className="max-w-full truncate text-[11px] text-t2">{l.place}</p> : null}
            {spotlight ? (
              <p className="mt-0.5 font-mono text-[17px] font-extrabold leading-none text-t0 tabular-nums sm:text-[18px]">
                {formatAmount(l.revenue)}
              </p>
            ) : null}
            <p className={cn("mt-0.5 text-[11px]", spotlight ? "font-medium text-t3" : "font-semibold text-t2")}>
              {num(l.sales)} {l.sales === 1 ? "venda" : "vendas"}
            </p>
            {spotlight ? null : (
              <p className="mt-0.5 font-mono text-[13px] font-extrabold tabular-nums sm:text-[14px]" style={{ color: medal.color }}>
                {formatAmount(l.revenue)}
              </p>
            )}
            {l.note ? (
              <span className={cn("max-w-full", spotlight ? "mt-1" : "mt-1.5")}>
                <Badge variant="accent">{l.note}</Badge>
              </span>
            ) : null}
            {l.gap ? <p className="mt-1 max-w-full text-[11px] font-semibold leading-tight text-t1">{l.gap}</p> : null}

            <div
              className={cn(
                "flex w-full items-end justify-center rounded-t-2xl transition duration-200 group-hover:brightness-125",
                spotlight ? "mt-2" : "mt-3",
                spotlight ? PODIO_HEIGHT_COMPACT[pos] : PODIO_HEIGHT[pos],
              )}
              style={{
                background: "color-mix(in srgb, var(--acc) 48%, transparent)",
                boxShadow: isOuro ? "0 8px 28px color-mix(in srgb, var(--acc) 35%, transparent)" : undefined,
              }}
            >
              <span
                className="pb-3 text-[24px] font-extrabold leading-none sm:text-[28px]"
                style={{ color: medal.color }}
              >
                {pos}º
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
