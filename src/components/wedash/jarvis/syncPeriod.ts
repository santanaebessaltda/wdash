import type { NavigateFunction } from "react-router-dom";
import type { PeriodType } from "@/data/wedash/dashboard";
import { PERIOD_STORAGE_KEY } from "@/session/periodStorage";
import { routeShowsPeriod } from "@/pages/dashboard/periodQuery";
import { periodKindFromQuestion } from "./salesBrief";

/** Alinha o filtro de período do Dashboard com a pergunta (ex.: “hoje” → period=today). */
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

  if (!routeShowsPeriod(pathname)) return kind;

  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  params.set("period", kind);
  params.delete("from");
  params.delete("to");
  const q = params.toString();
  navigate({ pathname, search: q ? `?${q}` : "" }, { replace: true });
  return kind;
}
