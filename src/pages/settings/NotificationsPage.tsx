import { useEffect, useState } from "react";
import { Button, Card, useToast } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import { CheckIcon } from "@/pages/utility/icons";
import { enableSalesPush } from "@/push/salesPush";
import { useActiveSession } from "@/session/SessionProvider";

type Aparelho = "pedir" | "ativo" | "bloqueado" | "indisponivel";

function aparelhoAtual(): Aparelho {
  if (typeof Notification === "undefined" || !("PushManager" in window) || !("serviceWorker" in navigator)) return "indisponivel";
  if (Notification.permission === "granted") return "ativo";
  if (Notification.permission === "denied") return "bloqueado";
  return "pedir";
}

type PrefKey = "sales" | "quiet" | "cashClose" | "storeGoal";

type Prefs = Record<PrefKey, boolean>;

const DEFAULTS: Prefs = { sales: true, quiet: false, cashClose: true, storeGoal: true };

const ROWS: Array<{ key: PrefKey; name: string; desc: string }> = [
  { key: "sales", name: "Vendas do período", desc: "Receba o total vendido a cada 30 minutos e, quando disponível, o valor de cada loja." },
  { key: "quiet", name: "Sem venda no período", desc: "Receba um aviso quando um período de 30 minutos terminar sem novas vendas." },
  { key: "cashClose", name: "Fechamento", desc: "Receba um resumo do fechamento do dia, com faltas ou sobras em dinheiro e dias ainda sem total real." },
  { key: "storeGoal", name: "Meta da loja", desc: "Receba um aviso quando a loja atingir um novo nível da meta. Cada nível é avisado uma única vez." },
];

function Dot({ on }: { on: boolean }) {
  return (
    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[7px] ${on ? "bg-ok" : "bg-bg-inset"}`}>
      {on && <CheckIcon size={13} className="text-white" />}
    </span>
  );
}

/** Conta > Notificações. Só o que o push já envia, e cada linha liga ou desliga. */
export function NotificationsPage() {
  const session = useActiveSession();
  const { show } = useToast();
  const [aparelho, setAparelho] = useState<Aparelho>(aparelhoAtual);
  const [pedindo, setPedindo] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [userId, setUserId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let vivo = true;
    void (async () => {
      const { data: auth } = await sb.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || !vivo) return;
      setUserId(uid);
      const { data, error } = await sb
        .from("notification_pref")
        .select("sales, quiet, cash_close, store_goal")
        .eq("auth_user_id", uid)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();
      if (!vivo) return;
      if (error) {
        setErro("Não foi possível carregar as notificações. Tente novamente.");
        return;
      }
      if (!data) return;
      setPrefs({
        sales: Boolean(data.sales),
        quiet: Boolean(data.quiet),
        cashClose: Boolean(data.cash_close),
        storeGoal: Boolean(data.store_goal),
      });
    })();
    return () => {
      vivo = false;
    };
  }, [session.tenantId]);

  async function ativarCelular() {
    setPedindo(true);
    const r = await enableSalesPush(session.tenantId);
    setPedindo(false);
    if (r === "ok") {
      setAparelho("ativo");
      show("Avisos ativados neste celular.", "success");
    } else if (r === "denied") {
      setAparelho("bloqueado");
      show("O navegador bloqueou os avisos. Libere as notificações da WDash.", "warning");
    } else {
      setAparelho("indisponivel");
      show("Este aparelho não recebe avisos. No iPhone, instale a WDash na Tela de Início.", "warning");
    }
  }

  async function alternar(key: PrefKey) {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setErro(null);
    const { error } = await sb.from("notification_pref").upsert(
      {
        auth_user_id: userId,
        tenant_id: session.tenantId,
        sales: next.sales,
        quiet: next.quiet,
        cash_close: next.cashClose,
        store_goal: next.storeGoal,
      },
      { onConflict: "auth_user_id,tenant_id" },
    );
    if (error) {
      setPrefs(prefs);
      setErro("Não foi possível salvar as alterações. Tente novamente.");
    }
  }

  return (
    <Card className="max-w-[720px]">
      <h3 className="mb-1 text-[15px] font-bold text-t0">Avisos no celular</h3>
      <p className="mb-4 text-[12.5px] text-t2">Ative ou desative os avisos que deseja receber.</p>
      {aparelho === "pedir" ? (
        <Button size="lg" fullWidth className="mb-4.5 !h-[46px] font-bold" disabled={pedindo} onClick={() => void ativarCelular()}>
          {pedindo ? "Pedindo permissão…" : "Ativar neste celular"}
        </Button>
      ) : (
        <p className="mb-4.5 text-[12.5px] text-t2">
          {aparelho === "ativo"
            ? "Este celular já recebe os avisos."
            : aparelho === "bloqueado"
              ? "O navegador bloqueou os avisos. Libere as notificações da WDash."
              : "Este aparelho não recebe avisos. No iPhone, instale a WDash na Tela de Início."}
        </p>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-line pb-3 text-[10.5px] font-bold uppercase tracking-wide text-t2">
        <span>Avisar sobre</span>
        <span className="w-[50px] text-center">Push</span>
      </div>
      {ROWS.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line py-3.5 last:border-b-0">
          <div>
            <p className="text-[13.5px] font-bold text-t0">{row.name}</p>
            <p className="mt-0.5 text-[11.5px] text-t2">{row.desc}</p>
          </div>
          <span className="flex w-[50px] justify-center">
            <button type="button" aria-pressed={prefs[row.key]} aria-label={row.name} onClick={() => void alternar(row.key)}>
              <Dot on={prefs[row.key]} />
            </button>
          </span>
        </div>
      ))}
      {erro && <p className="mt-3 text-[12.5px] text-t2">{erro}</p>}
    </Card>
  );
}
