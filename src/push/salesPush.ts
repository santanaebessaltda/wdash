import { getSupabase } from "@/lib/supabase";
import { VAPID_PUBLIC_KEY } from "./vapidPublic";

function chave(): Uint8Array {
  const pad = "=".repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
  const b64 = (VAPID_PUBLIC_KEY + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let pedidoNestaAbertura: string | null = null;
let gravando: Promise<void> = Promise.resolve();
let ultimaRenovacao = 0;
/** Duas aberturas seguidas não trocam a inscrição duas vezes. */
const FOLGA_MS = 60_000;
/** Com o app aberto, a inscrição do iPhone expira. Renova antes da próxima rodada. */
const INTERVALO_MS = 15 * 60_000;

/**
 * Depois do login (e ao reabrir o app já logado): se o aparelho ainda não decidiu,
 * pede a permissão uma vez. Quem já permitiu é renovado por `watchSalesPush`.
 * No iPhone o sistema só mostra o pedido com o app na Tela de Início.
 */
export async function pedirPermissaoAposLogin(tenantId: string, membershipId: string): Promise<void> {
  if (pedidoNestaAbertura === membershipId) return;
  pedidoNestaAbertura = membershipId;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "default") return;
  await enableSalesPush(tenantId);
}

/** Pede permissão e grava a inscrição. No iPhone só funciona com o app na Tela de Início. */
export async function enableSalesPush(tenantId: string): Promise<"ok" | "denied" | "unsupported"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return "denied";
  await gravarInscricao(tenantId, false);
  return "ok";
}

/**
 * Grava a inscrição. Com `renew`, troca a do iPhone — ela morre ao abrir o app pelo aviso
 * e o worker apaga a antiga. Sem a troca, o próximo aviso não tem para quem ir.
 */
export async function refreshSalesPush(tenantId: string, opts?: { renew?: boolean; force?: boolean }): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const passou = Date.now() - ultimaRenovacao;
  const querTrocar = opts?.renew === true || opts?.force === true;
  const trocar = querTrocar && passou >= FOLGA_MS && (opts?.force === true || passou >= INTERVALO_MS);
  if (querTrocar && !trocar) return;
  if (trocar) ultimaRenovacao = Date.now();
  try {
    await gravarInscricao(tenantId, trocar);
  } catch (e) {
    if (trocar) ultimaRenovacao = 0;
    console.warn("push_subscription:", e instanceof Error ? e.message : String(e));
  }
}

type ChavesPush = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

function inscricaoValida(json: ChavesPush): json is { endpoint: string; keys: { p256dh: string; auth: string } } {
  return Boolean(json.endpoint && json.keys?.p256dh && json.keys.auth);
}

/**
 * Enquanto a sessão existe: cria de novo a inscrição ao abrir (também pelo aviso)
 * e de tempos em tempos com o app aberto. Sem isso o iPhone fica mudo depois do primeiro aviso.
 */
export function watchSalesPush(tenantId: string): () => void {
  const renovar = (force: boolean) => {
    void refreshSalesPush(tenantId, { renew: true, force });
  };
  const onVisible = () => {
    if (document.visibilityState === "hidden") return;
    renovar(false);
  };
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; subscription?: ChavesPush } | null;
    if (data?.type === "wedash:notification-open") renovar(true);
    if (data?.type === "wedash:push-subscription" && data.subscription) {
      void salvarInscricao(tenantId, data.subscription);
    }
  };
  renovar(true);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  window.addEventListener("focus", onVisible);
  navigator.serviceWorker.addEventListener("message", onMessage);
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") renovar(false);
  }, INTERVALO_MS);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onVisible);
    window.removeEventListener("focus", onVisible);
    navigator.serviceWorker.removeEventListener("message", onMessage);
    window.clearInterval(timer);
  };
}

async function gravarInscricao(tenantId: string, renovar: boolean): Promise<void> {
  const vez = gravando.then(() => fazerGravacao(tenantId, renovar));
  gravando = vez.catch(() => undefined);
  return vez;
}

async function fazerGravacao(tenantId: string, renovar: boolean): Promise<void> {
  const registro = await navigator.serviceWorker.ready;
  let atual = await registro.pushManager.getSubscription();
  if (renovar && atual) {
    await atual.unsubscribe().catch(() => undefined);
    atual = null;
  }
  const inscricao =
    atual ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chave() as BufferSource,
    }));
  await salvarInscricao(tenantId, inscricao.toJSON());
}

async function salvarInscricao(tenantId: string, json: ChavesPush): Promise<void> {
  if (!inscricaoValida(json)) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  const { error } = await sb.from("push_subscription").upsert(
    {
      auth_user_id: userId,
      tenant_id: tenantId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) console.warn("push_subscription:", error.message);
}
