import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { scopeShowsBrandPicker, type Division } from "@/data/wedash/stores";
import type { Scope, PeriodType } from "@/data/wedash/dashboard";
import { useActiveSession } from "@/session/SessionProvider";
import { PERIOD_STORAGE_KEY } from "@/session/periodStorage";
import { routeShowsPeriod } from "./periodQuery";

const PERIODOS: PeriodType[] = [
  "hoje",
  "estaSemana",
  "esteMes",
  "esteTrimestre",
  "esteSemestre",
  "esteAno",
  "ontem",
  "7dias",
  "mesPassado",
  "personalizado",
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

const PERIODO_PADRAO: PeriodType = "hoje";

type PeriodoSalvo = { tipo: PeriodType; de?: string; ate?: string };

function lerPeriodoSalvo(): PeriodoSalvo | null {
  try {
    const raw = sessionStorage.getItem(PERIOD_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PeriodoSalvo>;
    if (!p.tipo || !PERIODOS.includes(p.tipo)) return null;
    return { tipo: p.tipo, de: p.de, ate: p.ate };
  } catch {
    return null;
  }
}

function salvarPeriodo(p: PeriodoSalvo) {
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

function periodoDaUrl(params: URLSearchParams): PeriodoSalvo | null {
  const tipo = firstParam(params, ["period", "periodo"]) as PeriodType | null;
  if (!tipo || !PERIODOS.includes(tipo)) return null;
  return { tipo, de: firstParam(params, ["from", "de"]) ?? undefined, ate: firstParam(params, ["to", "ate"]) ?? undefined };
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
  const { pathname } = useLocation();
  const mostraPeriodo = routeShowsPeriod(pathname);
  const [params, setParams] = useSearchParams();
  const [catalogTick, setCatalogTick] = useState(0);

  useEffect(() => {
    const onStores = () => setCatalogTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const escopo = useMemo<Scope>(() => {
    const hasBranchParameter = params.has("store") || params.has("filial");
    const filialRaw = firstParam(params, ["store", "filial"]);
    let idsRaw = filialRaw ? filialRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

    // Sem `?filial=` na URL (navegacao pelo menu): recupera a ultima loja.
    if (!hasBranchParameter) {
      const salva = readSavedBranch();
      if (salva) idsRaw = [salva];
    }

    // So aceita ids que a sessao realmente pode ver; single-select  ->  no max. 1.
    const validos = idsRaw.filter((id) => session.stores.includes(id));
    const filialIds =
      validos.length === 0
        ? session.stores.length === 1
          ? [session.stores[0]]
          : []
        : [validos[0]];

    // Sem `?periodo=` (navegacao pelo menu): ultimo periodo da sessao; senao Hoje.
    const per = periodoDaUrl(params) ?? lerPeriodoSalvo() ?? { tipo: PERIODO_PADRAO };
    const divisaoParam = firstParam(params, ["brand", "divisao"]);
    const divisao: Division | null = divisaoParam === "WEPINK" || divisaoParam === "WPINK" ? divisaoParam : null;

    return {
      filialIds,
      periodo: per.tipo === "personalizado" ? { tipo: per.tipo, inicio: per.de, fim: per.ate } : { tipo: per.tipo },
      divisao,
    };
  }, [params, session.stores]);

  const showBrandPicker = useMemo(
    () => scopeShowsBrandPicker(escopo.filialIds, session.stores),
    [escopo.filialIds, session.stores, catalogTick],
  );

  // Mantem storage alinhado com a URL (bookmark / share / abas do Dashboard).
  useEffect(() => {
    if (params.has("store") || params.has("filial")) saveBranch(firstParam(params, ["store", "filial"])?.split(",")[0]?.trim() || "");
    const per = periodoDaUrl(params);
    if (per) salvarPeriodo(per);
  }, [params]);

  // Uma escrita só: filial, periodo (só com o campo) e divisao. Dois setParams no mesmo
  // render se apagam — o segundo navega com a query antiga.
  useEffect(() => {
    const p = new URLSearchParams(params);
    let dirty = false;

    if (!mostraPeriodo) {
      for (const key of ["period", "from", "to", "periodo", "de", "ate"]) {
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
    if (p.has("periodo")) {
      if (!p.has("period")) p.set("period", p.get("periodo") ?? "");
      p.delete("periodo");
      dirty = true;
    }
    if (p.has("de")) {
      if (!p.has("from")) p.set("from", p.get("de") ?? "");
      p.delete("de");
      dirty = true;
    }
    if (p.has("ate")) {
      if (!p.has("to")) p.set("to", p.get("ate") ?? "");
      p.delete("ate");
      dirty = true;
    }
    if (p.has("divisao")) {
      if (!p.has("brand")) p.set("brand", p.get("divisao") ?? "");
      p.delete("divisao");
      dirty = true;
    }

    if (!p.has("store")) {
      const id = escopo.filialIds[0];
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
    setParams(p, { replace: true });
  }, [mostraPeriodo, params, escopo.filialIds, showBrandPicker, setParams]);

  function mudar(e: Scope) {
    const p = new URLSearchParams();
    // Array vazio = "Todas as lojas"  ->  nao grava id (URL limpa) + storage "".
    // Single-select: grava no max. o primeiro id.
    if (e.filialIds.length > 0) {
      p.set("store", e.filialIds[0]);
      saveBranch(e.filialIds[0]);
    } else {
      saveBranch("");
    }
    // Fora das telas com o campo, o periodo fica só no sessionStorage.
    if (mostraPeriodo) {
      p.set("period", e.periodo.tipo);
      if (e.periodo.tipo === "personalizado") {
        if (e.periodo.inicio) p.set("from", e.periodo.inicio);
        if (e.periodo.fim) p.set("to", e.periodo.fim);
      }
    }
    salvarPeriodo({ tipo: e.periodo.tipo, de: e.periodo.inicio, ate: e.periodo.fim });
    const keepBrand = scopeShowsBrandPicker(e.filialIds, session.stores);
    if (keepBrand && e.divisao) p.set("brand", e.divisao);
    setParams(p, { replace: true });
  }

  return { escopo, mudar, showBrandPicker };
}

/**
 * Detalhe ou edicao de um registro de uma loja. Ao escolher outra loja no topo,
 * volta para a lista. "Todas as lojas" permanece na tela.
 */
export function useReturnWhenStoreChanges(storeId: string | undefined, to: string) {
  const navigate = useNavigate();
  const { escopo } = useScope();
  const loja = escopo.filialIds[0];
  useEffect(() => {
    if (!storeId || !loja || storeId === loja) return;
    navigate(to, { replace: true });
  }, [storeId, loja, to, navigate]);
}
