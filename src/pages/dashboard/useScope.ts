import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { scopeShowsBrandPicker, type Division } from "@/data/wedash/stores";
import type { Scope, PeriodType } from "@/data/wedash/dashboard";
import { useActiveSession } from "@/session/SessionProvider";
import { PERIOD_STORAGE_KEY } from "@/session/periodStorage";
import { routeShowsPeriod } from "./periodQuery";

const PERIOD_TYPES: PeriodType[] = [
  "today",
  "thisWeek",
  "thisMonth",
  "thisQuarter",
  "thisHalf",
  "thisYear",
  "yesterday",
  "last7Days",
  "lastMonth",
  "custom",
];

/** Store filter  -  survives navigation even when Link omits `?filial=`. */
const STORE_STORAGE_KEY = "wedash.store";
const STORE_STORAGE_KEY_LEGACY = "gestao.filial";

function readSavedBranch(): string | null {
  try {
    return sessionStorage.getItem(STORE_STORAGE_KEY) ?? sessionStorage.getItem(STORE_STORAGE_KEY_LEGACY);
  } catch {
    return null;
  }
}

function saveBranch(id: string) {
  try {
    sessionStorage.setItem(STORE_STORAGE_KEY, id);
    sessionStorage.removeItem(STORE_STORAGE_KEY_LEGACY);
  } catch {
    /* private mode / quota  -  URL ainda works on the same screen */
  }
}

const DEFAULT_PERIOD: PeriodType = "today";

/** Filial, período e marca. Só muda quando o filtro da tela muda. */
export function scopeFilterKey(scope: Scope): string {
  const ids = [...scope.storeIds].sort().join(",");
  const { kind, start, end } = scope.period;
  return `${ids}|${kind}|${start ?? ""}|${end ?? ""}|${scope.division ?? ""}`;
}

type SavedPeriod = { kind: PeriodType; from?: string; to?: string };

function readSavedPeriod(): SavedPeriod | null {
  try {
    const raw = sessionStorage.getItem(PERIOD_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SavedPeriod>;
    if (!p.kind || !PERIOD_TYPES.includes(p.kind)) return null;
    return { kind: p.kind, from: p.from, to: p.to };
  } catch {
    return null;
  }
}

function savePeriod(p: SavedPeriod) {
  try {
    sessionStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota */
  }
}

function firstParam(params: URLSearchParams, keys: string[]): string | null {
  for (const key of keys) {
    if (params.has(key)) return params.get(key);
  }
  return null;
}

function periodFromUrl(params: URLSearchParams): SavedPeriod | null {
  const kind = params.get("period") as PeriodType | null;
  if (!kind || !PERIOD_TYPES.includes(kind)) return null;
  return { kind, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
}

/**
 * Escopo (lojas, periodo, divisao) mora na URL, nao no estado de uma pagina.
 * **Loja** fica na URL de todas as telas (o menu copia `filial`) e no sessionStorage.
 * **Periodo** vale em todas as telas via sessionStorage; `periodo`/`de`/`ate` so entram
 * na URL das telas que mostram o campo. Periodo padrao = Hoje.
 *
 * Single-select de loja: `filial` na URL e um id (ex.: "filial=f1").
 * Ausente / vazio = "Todas as lojas" (consolida a rede), salvo se houver
 * preferencia salva (ai reidrata a loja escolhida).
 * Se a URL ainda tiver lista antiga ("f1,f2"), usa so o primeiro id.
 */
export function useScope() {
  const session = useActiveSession();
  const location = useLocation();
  const { pathname } = location;
  const showsPeriod = routeShowsPeriod(pathname);
  const [params, setParams] = useSearchParams();
  const [catalogTick, setCatalogTick] = useState(0);

  useEffect(() => {
    const onStores = () => setCatalogTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const scope = useMemo<Scope>(() => {
    const hasBranchParameter = params.has("store") || params.has("filial");
    const branchRaw = firstParam(params, ["store", "filial"]);
    let idsRaw = branchRaw ? branchRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

    // Sem `?filial=` na URL (navegacao pelo menu): recupera a ultima loja.
    if (!hasBranchParameter) {
      const saved = readSavedBranch();
      if (saved) idsRaw = [saved];
    }

    // So aceita ids que a sessao realmente pode ver; single-select  ->  no max. 1.
    const validos = idsRaw.filter((id) => session.stores.includes(id));
    const storeIds =
      validos.length === 0
        ? session.stores.length === 1
          ? [session.stores[0]]
          : []
        : [validos[0]];

    // Sem `?periodo=` (navegacao pelo menu): ultimo periodo da sessao; senao Hoje.
    const per = periodFromUrl(params) ?? readSavedPeriod() ?? { kind: DEFAULT_PERIOD };
    const divisionParam = firstParam(params, ["brand", "divisao"]);
    const division: Division | null = divisionParam === "WEPINK" || divisionParam === "WPINK" ? divisionParam : null;

    return {
      storeIds,
      period: per.kind === "custom" ? { kind: per.kind, start: per.from, end: per.to } : { kind: per.kind },
      division,
    };
  }, [params, session.stores]);

  const showBrandPicker = useMemo(
    () => scopeShowsBrandPicker(scope.storeIds, session.stores),
    [scope.storeIds, session.stores, catalogTick],
  );

  // Mantem storage alinhado com a URL (bookmark / share / abas do Dashboard).
  useEffect(() => {
    if (params.has("store") || params.has("filial")) saveBranch(firstParam(params, ["store", "filial"])?.split(",")[0]?.trim() || "");
    const per = periodFromUrl(params);
    if (per) savePeriod(per);
  }, [params]);

  // Uma escrita só: filial, periodo (só com o campo) e divisao. Dois setParams no mesmo
  // render se apagam — o segundo navega com a query antiga.
  useEffect(() => {
    const p = new URLSearchParams(params);
    let dirty = false;

    if (!showsPeriod) {
      for (const key of ["period", "from", "to"]) {
        if (!p.has(key)) continue;
        p.delete(key);
        dirty = true;
      }
    }

    if (p.has("filial")) {
      if (!p.has("store")) p.set("store", p.get("filial") ?? "");
      p.delete("filial");
      dirty = true;
    }
    if (p.has("divisao")) {
      if (!p.has("brand")) p.set("brand", p.get("divisao") ?? "");
      p.delete("divisao");
      dirty = true;
    }
    for (const key of ["periodo", "de", "ate"]) {
      if (!p.has(key)) continue;
      p.delete(key);
      dirty = true;
    }

    const periodValue = p.get("period");
    if (periodValue && !PERIOD_TYPES.includes(periodValue as PeriodType)) {
      p.delete("period");
      p.delete("from");
      p.delete("to");
      dirty = true;
    }

    if (!p.has("store")) {
      const id = scope.storeIds[0];
      if (id) {
        p.set("store", id);
        dirty = true;
      }
    }

    if (!showBrandPicker && p.has("brand")) {
      p.delete("brand");
      dirty = true;
    }

    if (!dirty) return;
    // Sem o state, o replace apaga a origem e o Voltar do detalhe cai na lista.
    setParams(p, { replace: true, state: location.state });
  }, [showsPeriod, params, scope.storeIds, showBrandPicker, setParams, location.state]);

  function setScope(e: Scope) {
    const p = new URLSearchParams();
    // Array vazio = "Todas as lojas"  ->  nao grava id (URL limpa) + storage "".
    // Single-select: grava no max. o primeiro id.
    if (e.storeIds.length > 0) {
      p.set("store", e.storeIds[0]);
      saveBranch(e.storeIds[0]);
    } else {
      saveBranch("");
    }
    // Fora das telas com o campo, o periodo fica só no sessionStorage.
    if (showsPeriod) {
      p.set("period", e.period.kind);
      if (e.period.kind === "custom") {
        if (e.period.start) p.set("from", e.period.start);
        if (e.period.end) p.set("to", e.period.end);
      }
    }
    savePeriod({ kind: e.period.kind, from: e.period.start, to: e.period.end });
    const keepBrand = scopeShowsBrandPicker(e.storeIds, session.stores);
    if (keepBrand && e.division) p.set("brand", e.division);
    setParams(p, { replace: true, state: location.state });
  }

  return { scope, setScope, showBrandPicker };
}

/**
 * Detalhe ou edicao de um registro de uma loja. Ao escolher outra loja no topo,
 * volta para a lista. "Todas as lojas" permanece na tela.
 */
export function useReturnWhenStoreChanges(storeId: string | undefined, to: string) {
  const navigate = useNavigate();
  const { scope } = useScope();
  const store = scope.storeIds[0];
  useEffect(() => {
    if (!storeId || !store || storeId === store) return;
    navigate(to, { replace: true });
  }, [storeId, store, to, navigate]);
}
