import { isNavGroup } from "@/layout/nav-config";
import { applyShoppingMenu, helpNavItem, navForRole } from "@/layout/nav-wedash";
import type { Role } from "@/data/wedash/team";
import { paths } from "@/router/paths";

export type NavigateTarget = { label: string; to: string; group: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Destinos que o Gestor pode abrir por voz (mesmo mapa do CommandPalette + JARVIS). */
export function jarvisNavTargets(
  role: Role,
  menu: { settings: boolean; report: boolean } = { settings: true, report: true },
): NavigateTarget[] {
  const fromNav = applyShoppingMenu(navForRole(role), menu).flatMap((entry) =>
    isNavGroup(entry)
      ? entry.items.map((i) => ({ label: i.label, to: i.to, group: entry.label }))
      : [{ label: entry.label, to: entry.to, group: "Principal" }],
  );
  return [
    ...fromNav,
    { label: helpNavItem.label, to: helpNavItem.to, group: "Ajuda" },
    { label: "JARVIS", to: paths.jarvis, group: "Principal" },
  ];
}

const ALIASES: Record<string, string> = {
  "visao geral": paths.overview,
  overview: paths.overview,
  inicio: paths.overview,
  home: paths.overview,
  dashboard: paths.overview,
  financeiro: paths.financial,
  finance: paths.financial,
  produtos: paths.products,
  equipe: paths.management.team,
  staff: paths.management.team,
  escala: paths.management.schedule,
  estoque: paths.stock.inventory,
  "pedido de compra": paths.management.purchaseOrder,
  pedido: paths.management.purchaseOrder,
  metas: paths.goals,
  meta: paths.goals,
  desafios: paths.management.challenges,
  desafio: paths.management.challenges,
  fechamento: paths.management.cashClose,
  sangrias: paths.management.cashDrop,
  carteira: paths.management.wallet,
  "informe de vendas": paths.management.salesReport,
  informe: paths.management.salesReport,
  filial: paths.operation.branch,
  funcionamento: paths.operation.hours,
  jarvis: paths.jarvis,
};

export function looksLikeNavigate(raw: string): boolean {
  const p = norm(raw);
  return /(abre|abrir|entra|entrar|vai (pra|pro|para)|vamos (pra|pro|para)|mostra|mostrar|me leva|abre a tela|vai na|vai no)/.test(
    p,
  );
}

/** Resolve destino a partir da fala. Null se não bater em nenhuma tela. */
export function resolveNavigate(
  raw: string,
  role: Role,
  menu?: { settings: boolean; report: boolean },
): NavigateTarget | null {
  const p = norm(raw);
  const targets = jarvisNavTargets(role, menu);

  for (const [alias, to] of Object.entries(ALIASES)) {
    if (!p.includes(alias)) continue;
    const hit = targets.find((t) => t.to === to);
    if (hit) return hit;
    return { label: alias, to, group: "Principal" };
  }

  let best: NavigateTarget | null = null;
  let bestLen = 0;
  for (const t of targets) {
    const label = norm(t.label);
    if (label.length < 3) continue;
    if (p.includes(label) && label.length > bestLen) {
      best = t;
      bestLen = label.length;
    }
  }
  return best;
}

export function formatNavigateReply(target: NavigateTarget): string {
  return `Pronto — tô em ${target.label}.`;
}
