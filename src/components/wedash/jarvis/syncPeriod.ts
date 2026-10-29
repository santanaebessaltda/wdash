import type { NavigateFunction } from "react-router-dom";
import type { PeriodType } from "@/data/wedash/dashboard";
import { PERIOD_STORAGE_KEY } from "@/session/periodStorage";
import { routeShowsPeriod } from "@/pages/dashboard/periodQuery";
import { periodKindFromQuestion } from "./salesBrief";

const STORE_STORAGE_KEY = "wedash.store";
const STORE_STORAGE_KEY_LEGACY = "gestao.filial";

function readSavedStoreParam(): string {
  try {
    return sessionStorage.getItem(STORE_STORAGE_KEY) ?? sessionStorage.getItem(STORE_STORAGE_KEY_LEGACY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Grava o período da pergunta (ex.: “hoje” → today) no sessionStorage.
 * Se a URL atual for uma tela com filtro de período, alinha a query — sem sair do chat
 * (no chat flutuante só persiste storage para quando o Gestor abrir o Dashboard depois).
 */
export function syncScopePeriodFromQuestion(
  question: string,
  pathname: string,
  search: string,
  navigate: NavigateFunction,
): PeriodType | null {
  const kind = periodKindFromQuestion(question);
  if (!kind) return null;

  try {
    sessionStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ kind }));
  } catch {
    /* private mode */
  }

  const livePath =
    typeof window !== "undefined" && window.location.pathname
      ? window.location.pathname
      : pathname;
  const liveSearch =
    typeof window !== "undefined" && window.location.search
      ? window.location.search
      : search;

  if (!routeShowsPeriod(livePath)) return kind;

  const raw = liveSearch.startsWith("?") ? liveSearch.slice(1) : liveSearch;
  const params = new URLSearchParams(raw);
  params.set("period", kind);
  params.delete("from");
  params.delete("to");
  if (!params.has("store") && !params.has("filial")) {
    const saved = readSavedStoreParam();
    if (saved) params.set("store", saved);
  }
  const q = params.toString();
  navigate({ pathname: livePath, search: q ? `?${q}` : "" }, { replace: true });
  return kind;
}
