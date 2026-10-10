import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import { CheckIcon } from "@/pages/utility/icons";
import { useActiveSession } from "@/session/SessionProvider";

type PrefKey = "sales" | "quiet" | "cashClose" | "storeGoal";

type Prefs = Record<PrefKey, boolean>;

const DEFAULTS: Prefs = { sales: true, quiet: false, cashClose: true, storeGoal: true };

const ROWS: Array<{ key: PrefKey; name: string; desc: string }> = [
  { key: "sales", name: "Vendas do período", desc: "Total vendido a cada 30 minutos, com o valor de cada loja quando couber." },
  { key: "quiet", name: "Sem venda no período", desc: "Avisa também quando aqueles 30 minutos fecham sem venda nova." },
  { key: "cashClose", name: "Fechamento", desc: "Um resumo de madrugada: faltou ou sobrou no dinheiro, ou o dia ficou sem total real." },
  { key: "storeGoal", name: "Meta da loja", desc: "Uma vez, quando a loja cruza um nível da meta. Não repete na rodada seguinte." },
];

const LATER = [
  { name: "Meta do vendedor", desc: "O nível de cada pessoa ainda não entra na rodada automática." },
  { name: "Desafio", desc: "O prêmio do desafio ainda não entra na rodada automática." },
  { name: "Estoque", desc: "A busca de estoque não roda a cada 30 minutos." },
];

function Dot({ on }: { on: boolean }) {
  return (
    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[7px] ${on ? "bg-ok" : "bg-bg-inset"}`}>
      {on && <CheckIcon size={13} className="text-white" />}
    </span>
  );
}

/** Conta > Notificações. O mesmo cartão do Account do Vela; só o Push grava e envia. */
export function NotificationsPage() {
  const session = useActiveSession();
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
        setErro("Não foi possível carregar as notificações.");
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
      setErro("Não foi possível salvar. Tente de novo.");
    }
  }

  return (
    <Card className="max-w-[720px]">
      <h3 className="mb-1 text-[15px] font-bold text-t0">Notificações</h3>
      <p className="mb-4.5 text-[12.5px] text-t2">Escolha o que chega no celular. E-mail e SMS ainda não enviam.</p>
      <div className="grid grid-cols-[2fr_auto_auto_auto] gap-3 border-b border-line pb-3 text-[10.5px] font-bold uppercase tracking-wide text-t2">
        <span>Avisar sobre</span>
        <span className="w-[50px] text-center">E-mail</span>
        <span className="w-[50px] text-center">Push</span>
        <span className="w-[50px] text-center">SMS</span>
      </div>
      {ROWS.map((row) => (
        <div key={row.key} className="grid grid-cols-[2fr_auto_auto_auto] items-center gap-3 border-b border-line py-3.5">
          <div>
            <p className="text-[13.5px] font-bold text-t0">{row.name}</p>
            <p className="mt-0.5 text-[11.5px] text-t2">{row.desc}</p>
          </div>
          <span className="flex w-[50px] justify-center">
            <Dot on={false} />
          </span>
          <span className="flex w-[50px] justify-center">
            <button type="button" aria-pressed={prefs[row.key]} aria-label={row.name} onClick={() => void alternar(row.key)}>
              <Dot on={prefs[row.key]} />
            </button>
          </span>
          <span className="flex w-[50px] justify-center">
            <Dot on={false} />
          </span>
        </div>
      ))}
      {LATER.map((row) => (
        <div key={row.name} className="grid grid-cols-[2fr_auto_auto_auto] items-center gap-3 border-b border-line py-3.5 last:border-b-0">
          <div>
            <p className="text-[13.5px] font-bold text-t0">{row.name}</p>
            <p className="mt-0.5 text-[11.5px] text-t2">{row.desc}</p>
          </div>
          <span className="flex w-[50px] justify-center">
            <Dot on={false} />
          </span>
          <span className="flex w-[50px] justify-center">
            <Dot on={false} />
          </span>
          <span className="flex w-[50px] justify-center">
            <Dot on={false} />
          </span>
        </div>
      ))}
      {erro && <p className="mt-3 text-[12.5px] text-t2">{erro}</p>}
    </Card>
  );
}
