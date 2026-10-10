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

/** Pede permissão e grava a inscrição. No iPhone só funciona com o app na Tela de Início. */
export async function enableSalesPush(tenantId: string): Promise<"ok" | "denied" | "unsupported"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return "denied";
  await gravarInscricao(tenantId);
  return "ok";
}

/** Renova a inscrição se a pessoa já permitiu. Não abre o pedido de permissão. */
export async function refreshSalesPush(tenantId: string): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") return;
  await gravarInscricao(tenantId);
}

async function gravarInscricao(tenantId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  const registro = await navigator.serviceWorker.ready;
  const atual = await registro.pushManager.getSubscription();
  const inscricao =
    atual ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chave() as BufferSource,
    }));
  const json = inscricao.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
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
