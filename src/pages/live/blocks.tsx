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

/** Degrau do placar externo: alto o bastante para o 1º, o 2º e o 3º, sem estourar a tela. */
const PODIO_HEIGHT_FLAT: Record<1 | 2 | 3, string> = {
  1: "h-[4.75rem]",
  2: "h-14",
  3: "h-12",
};

const PODIO_SLOT: Record<1 | 2 | 3, { left: string; width: string }> = {
  1: { left: "33%", width: "34%" },
  2: { left: "0%", width: "33%" },
  3: { left: "67%", width: "33%" },
};

function WinsMark({ count, secret = false }: { count?: number; secret?: boolean }) {
  if (!count || count <= 0) return null;
  return (
    <span className="absolute -bottom-1 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-bg-2 px-1.5 py-px text-[10px] font-bold leading-none text-t0">
      <span aria-hidden>🏆</span>
      <span {...(secret ? { "data-secret": "" } : {})}>{count}</span>
    </span>
  );
}

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
  motion = false,
  flashId = null,
  secret = false,
}: {
  ranking: RankingRow[];
  formatAmount?: (v: number) => string;
  onSelect?: (row: RankingRow) => void;
  /** Faturamento maior; vendas ficam em apoio. Só o placar da loja. */
  spotlight?: boolean;
  /** O nome já vem curto. Sem isto, o pódio mostra só o primeiro nome. */
  literalName?: boolean;
  /** O avatar se desloca quando a posição muda. Só o placar externo. */
  motion?: boolean;
  /** A pessoa pisca depois da comemoração. Só o placar externo. */
  flashId?: string | null;
  /** Borra o faturamento e o valor em R$ que falta. Só o placar externo. */
  secret?: boolean;
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
    <div className={cn(motion ? "relative mx-auto h-[19.25rem] w-full max-w-3xl" : "flex items-end justify-center gap-2.5 sm:gap-6", !motion && (spotlight ? "pt-5" : "pt-7"))}>
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
                "group flex flex-col items-center text-center",
                motion ? "absolute bottom-0" : "transition-transform duration-200 hover:-translate-y-1.5",
                !motion && (isOuro ? "w-[34%] max-w-[168px]" : "w-[30%] max-w-[148px]"),
              )}
              style={motion ? { left: PODIO_SLOT[pos].left, width: PODIO_SLOT[pos].width } : undefined}
            >
              <div className={cn(motion ? "flex w-full flex-col items-center transition-transform duration-200 group-hover:-translate-y-1.5" : "contents")}>
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
                  "podium-step-empty flex w-full justify-center rounded-t-2xl transition-colors duration-200",
                  motion ? "items-center" : "items-end",
                  spotlight ? "mt-2" : "mt-3",
                  motion ? PODIO_HEIGHT_FLAT[pos] : spotlight ? PODIO_HEIGHT_COMPACT[pos] : PODIO_HEIGHT[pos],
                )}
              >
                <span className={cn("font-extrabold leading-none text-t3", motion ? (isOuro ? "text-[28px] sm:text-[32px]" : "text-[22px] sm:text-[24px]") : "pb-3 text-[24px] sm:text-[28px]")}>{pos}º</span>
              </div>
              </div>
            </div>
          );
        }
        return (
          <div
            key={l.employeeId}
            style={motion ? { left: PODIO_SLOT[pos].left, width: PODIO_SLOT[pos].width, transform: isOuro ? "scale(1.06)" : "scale(1)" } : undefined}
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
              "group flex flex-col items-center text-center",
              motion ? "absolute bottom-0 z-10 origin-bottom transition-[left,width,transform] duration-700 ease-out" : "transition-transform duration-200 hover:-translate-y-1.5",
              flashId === l.employeeId && "board-row-flash",
              !motion &&
                (spotlight
                  ? isOuro
                    ? "w-[34%] max-w-[200px]"
                    : "w-[30%] max-w-[168px]"
                  : isOuro
                    ? "w-[34%] max-w-[168px]"
                    : "w-[30%] max-w-[148px]"),
              onSelect && "cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-acc",
            )}
          >
            <div className={cn(motion ? "flex w-full flex-col items-center transition-transform duration-200 group-hover:-translate-y-1.5" : "contents")}>
            <div className={cn("relative transition-transform duration-200 group-hover:scale-[1.04]", spotlight ? "mb-1.5" : "mb-2.5")}>
              <span
                className={cn("relative inline-flex rounded-full", motion && isOuro && "board-breathe")}
                style={{
                  boxShadow: `0 0 0 3px ${medal.color}${isOuro ? `, ${medal.glow}` : ""}`,
                }}
              >
                <PersonAvatar size={isOuro ? "2xl" : "xl"} name={l.avatarName ?? l.name} employeeId={l.employeeId} storeId={l.storeId} />
              </span>
              <MedalhaBadge pos={pos} />
              <WinsMark count={l.wins} />
            </div>

            <p className={cn("max-w-full truncate font-bold text-t0", motion && isOuro ? "text-[15px] sm:text-[16px]" : "text-[13px] sm:text-[14px]")}>
              {literalName ? l.name : l.name.split(" ")[0]}
            </p>
            {l.place ? <p className="max-w-full truncate text-[11px] text-t2">{l.place}</p> : null}
            {spotlight ? (
              <p
                className={cn("mt-0.5 font-mono font-extrabold leading-none tabular-nums", motion && isOuro ? "text-[20px] sm:text-[22px]" : "text-[17px] sm:text-[18px]")}
                style={{ color: medal.color }}
                {...(secret ? { "data-secret": "" } : {})}
              >
                {formatAmount(l.revenue)}
              </p>
            ) : null}
            <p className={cn("mt-0.5 text-[11px]", spotlight ? "font-medium text-t3" : "font-semibold text-t2")}>
              {num(l.sales)} {l.sales === 1 ? "venda" : "vendas"}
            </p>
            {spotlight ? null : (
              <p className="mt-0.5 font-mono text-[13px] font-extrabold tabular-nums sm:text-[14px]" style={{ color: medal.color }} {...(secret ? { "data-secret": "" } : {})}>
                {formatAmount(l.revenue)}
              </p>
            )}
            {l.note ? (
              <span className={cn("max-w-full", spotlight ? "mt-1" : "mt-1.5")}>
                <Badge variant="accent">{l.note}</Badge>
              </span>
            ) : null}
            {l.gap ? <p className="mt-1 max-w-full text-[11px] font-semibold leading-tight text-t1" {...(secret ? { "data-secret": "" } : {})}>{l.gap}</p> : null}

            <div
              className={cn(
                "podium-step flex w-full justify-center rounded-t-2xl transition-colors duration-200",
                motion ? "mt-1.5 items-center" : spotlight ? "mt-2 items-end" : "mt-3 items-end",
                motion ? PODIO_HEIGHT_FLAT[pos] : spotlight ? PODIO_HEIGHT_COMPACT[pos] : PODIO_HEIGHT[pos],
              )}
              style={{
                boxShadow: isOuro ? "0 8px 28px color-mix(in srgb, var(--acc) 35%, transparent)" : undefined,
              }}
            >
              <span
                className={cn("font-extrabold leading-none", motion ? (isOuro ? "text-[28px] sm:text-[32px]" : "text-[22px] sm:text-[24px]") : "pb-3 text-[24px] sm:text-[28px]")}
                style={{ color: medal.color }}
              >
                {pos}º
              </span>
            </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
