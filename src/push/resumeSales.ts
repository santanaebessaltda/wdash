import { getSupabase } from "@/lib/supabase";

/** O service worker manda isto ao focar o app pelo aviso. O texto tem de ser o mesmo em `public/sw.js`. */
export const NOTIFICATION_OPEN = "wedash:notification-open";

const SESSION_WAIT_MS = 800;

export function isNotificationOpen(data: unknown): boolean {
  return Boolean(data) && typeof data === "object" && (data as { type?: unknown }).type === NOTIFICATION_OPEN;
}

/**
 * Leitura vazia ou falha não pode apagar a marca que já tínhamos.
 * Se apagar, a próxima leitura (mais nova) não avisa as telas e o valor fica antigo.
 */
export function watermarkAfterRead(prev: number | null, read: Date | null): number | null {
  if (!read) return prev;
  const next = read.getTime();
  return Number.isNaN(next) ? prev : next;
}

export function salesChanged(prev: number | null, next: number | null): boolean {
  return prev != null && next != null && next > prev;
}

/**
 * A marca nova sozinha não mexe na tela: rodada sem venda nova deixa tudo como está.
 * `changed === null` (não deu para ler) atualiza, para uma venda real não ficar escondida.
 */
export function shouldRefreshScreen(prev: number | null, next: number | null, changed: boolean | null): boolean {
  if (!salesChanged(prev, next)) return false;
  return changed !== false;
}

/**
 * O aviso pede esta conferência. Quem escuta é o Atualizar do topo.
 * Com `force` (toque no aviso): a tela relê o banco mesmo se a marca não avançou —
 * o push já prova que o número mudou; watermark com várias contas ERP pode ficar parado.
 */
export const CHECK_SALES_EVENT = "wedash:check-sales";

export type CheckSalesDetail = { force?: boolean };

export function isForcedSalesCheck(event: Event): boolean {
  return event instanceof CustomEvent && Boolean((event.detail as CheckSalesDetail | undefined)?.force);
}

let ticket = 0;

function whenSessionReady(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = window.setTimeout(finish, SESSION_WAIT_MS);
    sb.auth.getSession().then(
      () => {
        window.clearTimeout(timer);
        finish();
      },
      () => {
        window.clearTimeout(timer);
        finish();
      },
    );
  });
}

/** Toque no aviso: força a tela a reler as vendas (não depende da marca nem do visibilityState). */
export function reloadSalesAfterOpen(): void {
  const mine = ++ticket;
  void whenSessionReady().then(() => {
    if (mine !== ticket) return;
    window.dispatchEvent(new CustomEvent(CHECK_SALES_EVENT, { detail: { force: true } satisfies CheckSalesDetail }));
  });
}
