import { Avatar, EmptyState } from "@/components/ui";
import { brlK, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { RankingRow } from "@/data/wedash/live";
/** Medalhas do leaderboard Vela (SalesDashboard / CRM)  -  anel, trofeu e rotulos. */
const MEDALHA = {
  1: { cor: "#f7b84e", glow: "0 0 32px rgba(247,184,78,0.4)" },
  2: { cor: "#c7cdd6", glow: "none" },
  3: { cor: "#d99a5c", glow: "none" },
} as const;

const PODIO_ALTURA: Record<1 | 2 | 3, string> = {
  1: "h-44 sm:h-48",
  2: "h-36 sm:h-40",
  3: "h-28 sm:h-32",
};

/** Ordem visual do podio: 2 | 1 | 3 */
const PODIO_ORDEM = [1, 0, 2] as const;

const MEDALHA_EMOJI: Record<1 | 2 | 3, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function MedalhaBadge({ pos, apagada = false }: { pos: 1 | 2 | 3; apagada?: boolean }) {
  return (
    <span
      className={cn(
        "absolute -right-2 -top-2 text-[26px] leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]",
        apagada && "opacity-40 grayscale",
      )}
      aria-hidden
    >
      {MEDALHA_EMOJI[pos]}
    </span>
  );
}

/** Podio top 3  -  aba Ranking (ouro / prata / bronze; degrau na cor primaria). */
export function RankingBlock({
  ranking,
  formatValor = brlK,
  onSelect,
}: {
  ranking: RankingRow[];
  formatValor?: (v: number) => string;
  onSelect?: (row: RankingRow) => void;
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
    <div className="flex items-end justify-center gap-2.5 pt-3 sm:gap-6">
      {PODIO_ORDEM.map((i) => {
        const pos = (i + 1) as 1 | 2 | 3;
        const medal = MEDALHA[pos];
        const isOuro = pos === 1;
        const l = top3[i];
        if (!l) {
          return (
            <div
              key={`vazio-${pos}`}
              className={cn("flex flex-col items-center text-center", isOuro ? "w-[34%] max-w-[168px]" : "w-[30%] max-w-[148px]")}
            >
              <div className="relative mb-2.5">
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
                className={cn("mt-3 flex w-full items-end justify-center rounded-t-2xl", PODIO_ALTURA[pos])}
                style={{ background: "color-mix(in srgb, var(--acc) 16%, transparent)" }}
              >
                <span className="pb-3 text-[24px] font-extrabold leading-none text-t3 sm:text-[28px]">{pos}º</span>
              </div>
            </div>
          );
        }
        return (
          <div
            key={l.colaboradorId}
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
              "flex flex-col items-center text-center",
              isOuro ? "w-[34%] max-w-[168px]" : "w-[30%] max-w-[148px]",
              onSelect && "cursor-pointer rounded-2xl transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-acc",
            )}
          >
            <div className="relative mb-2.5">
              <span
                className="relative inline-flex rounded-full"
                style={{
                  boxShadow: `0 0 0 3px ${medal.cor}${isOuro ? `, ${medal.glow}` : ""}`,
                }}
              >
                <Avatar size={isOuro ? "2xl" : "xl"} name={l.nome} />
              </span>
              <MedalhaBadge pos={pos} />
            </div>

            <p className="truncate text-[13px] font-bold text-t0 sm:text-[14px]">{l.nome.split(" ")[0]}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-t2">
              {num(l.vendas)} {l.vendas === 1 ? "venda" : "vendas"}
            </p>
            <p className="mt-0.5 font-mono text-[13px] font-extrabold sm:text-[14px]" style={{ color: medal.cor }}>
              {formatValor(l.faturamento)}
            </p>

            <div
              className={cn(
                "mt-3 flex w-full items-end justify-center rounded-t-2xl",
                PODIO_ALTURA[pos],
              )}
              style={{
                background: "color-mix(in srgb, var(--acc) 48%, transparent)",
                boxShadow: isOuro ? "0 8px 28px color-mix(in srgb, var(--acc) 35%, transparent)" : undefined,
              }}
            >
              <span
                className="pb-3 text-[24px] font-extrabold leading-none sm:text-[28px]"
                style={{ color: medal.cor }}
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
