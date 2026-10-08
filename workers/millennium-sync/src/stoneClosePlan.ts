import { stoneFileReady } from "../../../src/data/wedash/stoneClock.ts";
import { STONE_PIX_RETRY_MS } from "./stonePix.ts";

export type StoneCloseStore = {
  storeId: string;
  tenantId: string;
  code: string;
  taxDigits: string;
  covers: "all" | "online_pix";
  /** Dias já encerrados para olhar (ontem e anteontem). */
  days: string[];
  /** Dias em que o Millennium registrou venda de Pix. */
  pixDays: string[];
};

export type StoneFileState = {
  storeId: string;
  day: string;
  card: "received" | null;
  pix: "requested" | "received" | null;
  pixRequestedAt: string | null;
};

export type StoneCloseAction = {
  storeId: string;
  tenantId: string;
  code: string;
  day: string;
  fetchCard: boolean;
  requestPix: boolean;
};

function staleRequest(requestedAt: string | null, now: Date): boolean {
  if (!requestedAt) return true;
  const t = Date.parse(requestedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= STONE_PIX_RETRY_MS;
}

/**
 * O que a madrugada ainda precisa buscar. Cartão só quando a loja usa Stone no
 * cartão. PIX de novo se o CSV não chegou e o pedido já passou do prazo.
 */
export function planStoneClose(now: Date, stores: StoneCloseStore[], files: StoneFileState[]): StoneCloseAction[] {
  const byKey = new Map(files.map((f) => [`${f.storeId}|${f.day}`, f]));
  const actions: StoneCloseAction[] = [];
  for (const store of stores) {
    for (const day of store.days) {
      if (!stoneFileReady(day, now)) continue;
      const file = byKey.get(`${store.storeId}|${day}`);
      const fetchCard = store.covers === "all" && file?.card !== "received";
      const requestPix =
        store.pixDays.includes(day) &&
        store.taxDigits.length >= 11 &&
        file?.pix !== "received" &&
        (file?.pix !== "requested" || staleRequest(file.pixRequestedAt, now));
      if (!fetchCard && !requestPix) continue;
      actions.push({
        storeId: store.storeId,
        tenantId: store.tenantId,
        code: store.code,
        day,
        fetchCard,
        requestPix,
      });
    }
  }
  return actions;
}
