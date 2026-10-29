import type { NavigateFunction } from "react-router-dom";
import type { PeriodType } from "@/data/wedash/dashboard";
import { PERIOD_STORAGE_KEY } from "@/session/periodStorage";
import { routeShowsPeriod, searchForRoute } from "@/pages/dashboard/periodQuery";
import { periodKindFromQuestion } from "./salesBrief";
import { scrollAppMain } from "./pageChrome";

const STORE_STORAGE_KEY = "wedash.store";
const STORE_STORAGE_KEY_LEGACY = "gestao.filial";

function readSavedStoreParam(): string {
  try {
    return sessionStorage.getItem(STORE_STORAGE_KEY) ?? sessionStorage.getItem(STORE_STORAGE_KEY_LEGACY) ?? "";
  } catch {
    return "";
  }
}

/** Injeta `period` na query se o destino mostra o filtro. */
export function searchWithPeriodFromQuestion(to: string, search: string, question: string): string {
  const base = searchForRoute(to, search);
  const kind = periodKindFromQuestion(question);
  if (!kind || !routeShowsPeriod(to)) return base;
  const params = new URLSearchParams(base.startsWith("?") ? base.slice(1) : base);
  params.set("period", kind);
  params.delete("from");
  params.delete("to");
  if (!params.has("store") && !params.has("filial")) {
    const saved = readSavedStoreParam();
    if (saved) params.set("store", saved);
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Alinha o filtro de período do Dashboard com a pergunta (ex.: “hoje” → period=today)
 * e sobe a página para o usuário ver o cabeçalho/filtros.
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

  // URL ao vivo (evita search/pathname defasado do VoiceDock / closure).
  const livePath =
    typeof window !== "undefined" && window.location.pathname
      ? window.location.pathname
      : pathname;
  const liveSearch =
    typeof window !== "undefined" && window.location.search
      ? window.location.search
      : search;

  if (!routeShowsPeriod(livePath)) {
    // Fora do Dashboard: só grava o período; na próxima tela com filtro ele entra via storage.
    return kind;
  }

  const raw = liveSearch.startsWith("?") ? liveSearch.slice(1) : liveSearch;
  const params = new URLSearchParams(raw);
  params.set("period", kind);
  params.delete("from");
  params.delete("to");
  // Garante loja na URL se o seletor estava só no sessionStorage.
  if (!params.has("store") && !params.has("filial")) {
    const saved = readSavedStoreParam();
    if (saved) params.set("store", saved);
  }
  const q = params.toString();
  navigate({ pathname: livePath, search: q ? `?${q}` : "" }, { replace: true });
  // Depois do navigate: sobe para o usuário ver o filtro mudando.
  window.setTimeout(() => scrollAppMain({ top: 0 }), 40);
  return kind;
}
