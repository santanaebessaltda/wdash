/**
 * millenium.LANCAMENTOS.Lista — sangrias da filial (ID_TIPOC -3).
 * DATAF é inclusivo, no mesmo bound das vendas (meia-noite de MS).
 */
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { milleniumDataRange } from "./millenniumSales.ts";
import { parseSangriaLista, type ParsedSangria } from "../../../src/data/wedash/sangriaMath.ts";

export type { ParsedSangria };

export async function fetchSangriaLista(params: {
  session: string;
  millenniumStoreId: number;
  from: string;
  to: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<ParsedSangria[]> {
  const base = (params.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const origin = base.replace(/\/api\/?$/, "");
  const { datai, dataf } = milleniumDataRange(params.from, params.to);
  const body = JSON.stringify({
    CONTA: null,
    DATAI: datai,
    DATAF: dataf,
    LANCAMENTO: null,
    DATA_FILTRO: "0",
    TIPOCTA: "X",
    N_DOCUMENTO: null,
    FILIAL: params.millenniumStoreId,
    ID_TIPOC: -3,
  });
  const res = await (params.fetchImpl ?? fetch)(`${base}/millenium.LANCAMENTOS.Lista?$top=500`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/files/web-apps/millennium.html`,
      "WTS-Session": params.session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`LANCAMENTOS.Lista ${res.status}`);
  return parseSangriaLista(await res.json());
}
