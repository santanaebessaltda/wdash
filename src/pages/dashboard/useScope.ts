import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { scopeShowsBrandPicker, type Division } from "@/data/wedash/stores";
import type { Scope, PeriodType } from "@/data/wedash/dashboard";
import { useActiveSession } from "@/session/SessionProvider";
import { PERIOD_STORAGE_KEY } from "@/session/periodStorage";

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

function lerFilialSalva(): string | null {
  try {
    return sessionStorage.getItem(STORE_STORAGE_KEY) ?? sessionStorage.getItem(STORE_STORAGE_KEY_LEGACY);
  } catch {
    return null;
  }
}

function salvarFilial(id: string) {
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

function periodoDaUrl(params: URLSearchParams): PeriodoSalvo | null {
  const tipo = params.get("periodo") as PeriodType | null;
  if (!tipo || !PERIODOS.includes(tipo)) return null;
  return { tipo, de: params.get("de") ?? undefined, ate: params.get("ate") ?? undefined };
}

/**
 * Escopo (lojas, periodo, divisao) mora na URL, nao no estado de uma pagina.
 * **Loja** e **periodo** tambem ficam em sessionStorage: sao filtros globais de todas as telas
 * e os NavLinks do menu nao carregam a query string. Periodo padrao = Hoje.
 *
 * Single-select de loja: `filial` na URL e um id (ex.: "filial=f1").
 * Ausente / vazio = "Todas as lojas" (consolida a rede), salvo se houver
 * preferencia salva (ai reidrata a loja escolhida).
 * Se a URL ainda tiver lista antiga ("f1,f2"), usa so o primeiro id.
 */
export function useScope() {
  const session = useActiveSession();
  const [params, setParams] = useSearchParams();
  const [catalogTick, setCatalogTick] = useState(0);

  useEffect(() => {
    const onStores = () => setCatalogTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const escopo = useMemo<Scope>(() => {
    const temParamFilial = params.has("filial");
    const filialRaw = params.get("filial");
    let idsRaw = filialRaw ? filialRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

    // Sem `?filial=` na URL (navegacao pelo menu): recupera a ultima loja.
    if (!temParamFilial) {
      const salva = lerFilialSalva();
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
    const divisaoParam = params.get("divisao");
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
    if (params.has("filial")) salvarFilial(params.get("filial")?.split(",")[0]?.trim() || "");
    const per = periodoDaUrl(params);
    if (per) salvarPeriodo(per);
  }, [params]);

  // Reidrata `?filial=` na URL quando a preferencia veio so do storage.
  useEffect(() => {
    if (params.has("filial")) return;
    const id = escopo.filialIds[0];
    if (!id) return;
    const p = new URLSearchParams(params);
    p.set("filial", id);
    setParams(p, { replace: true });
  }, [params, escopo.filialIds, setParams]);

  // Sem WPINK no escopo  ->  some o filtro e limpa `divisao` da URL.
  useEffect(() => {
    if (showBrandPicker) return;
    if (!params.get("divisao")) return;
    const p = new URLSearchParams(params);
    p.delete("divisao");
    setParams(p, { replace: true });
  }, [showBrandPicker, params, setParams]);

  function mudar(e: Scope) {
    const p = new URLSearchParams();
    // Array vazio = "Todas as lojas"  ->  nao grava id (URL limpa) + storage "".
    // Single-select: grava no max. o primeiro id.
    if (e.filialIds.length > 0) {
      p.set("filial", e.filialIds[0]);
      salvarFilial(e.filialIds[0]);
    } else {
      salvarFilial("");
    }
    p.set("periodo", e.periodo.tipo);
    if (e.periodo.tipo === "personalizado") {
      if (e.periodo.inicio) p.set("de", e.periodo.inicio);
      if (e.periodo.fim) p.set("ate", e.periodo.fim);
    }
    salvarPeriodo({ tipo: e.periodo.tipo, de: e.periodo.inicio, ate: e.periodo.fim });
    const keepBrand = scopeShowsBrandPicker(e.filialIds, session.stores);
    if (keepBrand && e.divisao) p.set("divisao", e.divisao);
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
