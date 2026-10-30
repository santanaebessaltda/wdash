import { paths } from "@/router/paths";

/** Telas com o campo de período. Nas outras a URL não leva `periodo`. */
const PERIOD_ROUTES = new Set<string>([
  paths.overview,
  paths.financial,
  paths.products,
  paths.team,
  paths.goals,
  paths.management.challenges,
  paths.management.schedule,
]);

const PERIOD_KEYS = ["period", "from", "to", "periodo", "de", "ate"] as const;
/** Parâmetro legado da Escala (`month=`) — menu / troca de tela não leva. */
const PAGE_LOCAL_KEYS = ["month"] as const;

export function routeShowsPeriod(pathname: string): boolean {
  return PERIOD_ROUTES.has(pathname);
}

function stripPageLocal(params: URLSearchParams): void {
  for (const key of PAGE_LOCAL_KEYS) params.delete(key);
}

/** Copia a query para outra tela. `periodo`, `de` e `ate` só seguem se o destino tem o campo. */
export function searchForRoute(to: string, search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return "";
  const pathname = to.split(/[?#]/)[0];
  if (routeShowsPeriod(pathname)) {
    const params = new URLSearchParams(raw);
    stripPageLocal(params);
    const q = params.toString();
    return q ? `?${q}` : "";
  }
  const params = new URLSearchParams(raw);
  for (const key of PERIOD_KEYS) params.delete(key);
  stripPageLocal(params);
  const q = params.toString();
  return q ? `?${q}` : "";
}
