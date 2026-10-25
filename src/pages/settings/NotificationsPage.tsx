import { useEffect, useState, type ReactNode } from "react";
import { Card, Segmented } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import { CheckIcon } from "@/pages/utility/icons";
import { useActiveSession } from "@/session/SessionProvider";

type StaffKey = "sales" | "cashClose" | "storeGoal" | "stock" | "plan";
type SellerKey = "goal" | "challenge" | "wallet" | "near" | "plan";
type StaffPrefs = Record<StaffKey, boolean>;
type SellerPrefs = Record<SellerKey, boolean>;

const STAFF_DEFAULTS: StaffPrefs = { sales: true, cashClose: true, storeGoal: true, stock: true, plan: true };
const SELLER_DEFAULTS: SellerPrefs = { goal: true, challenge: true, wallet: true, near: true, plan: true };

type SalesEvery = 30 | 60;

function salesDesc(every: SalesEvery): string {
  const cadence = every === 60 ? "A cada 1 hora" : "A cada 30 minutos";
  return `${cadence}, se alguma filial vendeu, o resumo mostra o que entrou no período e quanto cada filial já vendeu hoje. As filiais aparecem da que mais vendeu no dia para a que menos vendeu. Chega com o app aberto ou fechado.`;
}

const STAFF_ROWS: Array<{ key: StaffKey; name: string; desc?: string }> = [
  { key: "sales", name: "Vendas do período" },
  { key: "cashClose", name: "Fechamento", desc: "Receba um resumo do fechamento do dia, com faltas ou sobras em dinheiro e dias ainda sem total real." },
  { key: "storeGoal", name: "Meta da filial", desc: "Receba um aviso quando a filial atingir um novo nível da meta. Cada nível é avisado uma única vez." },
  { key: "stock", name: "Estoque abaixo do mínimo", desc: "Receba um aviso quando um produto ficar abaixo do mínimo definido para a filial." },
  { key: "plan", name: "Meta e desafio", desc: "Receba um aviso quando uma meta ou um desafio for publicado, ou quando o valor ou o percentual dos níveis mudar. Quem salvou não recebe o próprio aviso." },
];

const SELLER_ROWS: Array<{ key: SellerKey; name: string; desc: string }> = [
  { key: "goal", name: "Nível da sua meta", desc: "Receba um aviso quando você alcançar um novo nível. Cada nível é avisado uma única vez. Vender mais continua aumentando a premiação, sem um aviso a cada venda." },
  { key: "challenge", name: "Desafio", desc: "Receba um aviso quando você garantir o prêmio e quando o desafio encerrar, tenha ganho ou não." },
  { key: "wallet", name: "Carteira", desc: "Receba um aviso quando uma retirada ou uma quebra de caixa entrar na sua carteira." },
  { key: "near", name: "Perto do próximo nível", desc: "Receba um aviso quando faltar pouco para o próximo nível. No máximo uma vez por meta." },
  { key: "plan", name: "Meta e desafio", desc: "Receba um aviso quando uma meta ou um desafio seu for publicado, ou quando o valor ou o percentual dos níveis mudar." },
];

function Dot({ on }: { on: boolean }) {
  return (
    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[7px] ${on ? "bg-ok" : "bg-bg-inset"}`}>
      {on && <CheckIcon size={13} className="text-white" />}
    </span>
  );
}

function NoticeList({ children, error }: { children: ReactNode; error: string | null }) {
  return (
    <Card className="max-w-[720px]">
      <h3 className="mb-1 text-[15px] font-bold text-t0">Avisos no celular</h3>
      <p className="mb-4.5 text-[12.5px] text-t2">Ative ou desative os avisos que deseja receber.</p>
      <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-line pb-3 text-[10.5px] font-bold uppercase tracking-wide text-t2">
        <span>Avisar sobre</span>
        <span className="w-[50px] text-center">Push</span>
      </div>
      {children}
      {error && <p className="mt-3 text-[12.5px] text-t2">{error}</p>}
    </Card>
  );
}

function NoticeRow({ name, desc, on, extra, onToggle }: { name: string; desc?: string; on: boolean; extra?: ReactNode; onToggle: () => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line py-3.5 last:border-b-0">
      <div>
        <p className="text-[13.5px] font-bold text-t0">{name}</p>
        {desc ? <p className="mt-0.5 text-[11.5px] text-t2">{desc}</p> : null}
        {extra}
      </div>
      <span className="flex w-[50px] justify-center">
        <button type="button" aria-pressed={on} aria-label={name} onClick={onToggle}>
          <Dot on={on} />
        </button>
      </span>
    </div>
  );
}

/** Conta > Notificações do gestor e do gerente. Cada linha liga ou desliga o push. */
function StaffNotices() {
  const session = useActiveSession();
  const [prefs, setPrefs] = useState<StaffPrefs>(STAFF_DEFAULTS);
  const [salesEvery, setSalesEvery] = useState<SalesEvery>(30);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    void (async () => {
      const { data: auth } = await sb.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || !live) return;
      setUserId(uid);
      const { data, error } = await sb
        .from("notification_pref")
        .select("sales, cash_close, store_goal, stock, sales_every_min, plan")
        .eq("auth_user_id", uid)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();
      if (!live) return;
      if (error) {
        setError("Não foi possível carregar as notificações. Tente novamente.");
        return;
      }
      if (!data) return;
      setPrefs({
        sales: Boolean(data.sales),
        cashClose: Boolean(data.cash_close),
        storeGoal: Boolean(data.store_goal),
        stock: data.stock !== false,
        plan: data.plan !== false,
      });
      setSalesEvery(data.sales_every_min === 60 ? 60 : 30);
    })();
    return () => {
      live = false;
    };
  }, [session.tenantId]);

  async function persist(next: StaffPrefs, every: SalesEvery) {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const prev = { prefs, every: salesEvery };
    setPrefs(next);
    setSalesEvery(every);
    setError(null);
    const { error } = await sb.from("notification_pref").upsert(
      {
        auth_user_id: userId,
        tenant_id: session.tenantId,
        sales: next.sales,
        cash_close: next.cashClose,
        store_goal: next.storeGoal,
        stock: next.stock,
        plan: next.plan,
        sales_every_min: every,
      },
      { onConflict: "auth_user_id,tenant_id" },
    );
    if (error) {
      setPrefs(prev.prefs);
      setSalesEvery(prev.every);
      setError("Não foi possível salvar as alterações. Tente novamente.");
    }
  }

  function toggle(key: StaffKey) {
    void persist({ ...prefs, [key]: !prefs[key] }, salesEvery);
  }

  function changeEvery(every: SalesEvery) {
    if (every === salesEvery) return;
    void persist(prefs, every);
  }

  return (
    <NoticeList error={error}>
      {STAFF_ROWS.map((row) => (
        <NoticeRow
          key={row.key}
          name={row.name}
          desc={row.key === "sales" ? salesDesc(salesEvery) : row.desc}
          on={prefs[row.key]}
          onToggle={() => toggle(row.key)}
          extra={
            row.key === "sales" ? (
              <Segmented
                className="mt-2"
                options={[
                  { value: "30", label: "30 min" },
                  { value: "60", label: "1 hora" },
                ]}
                value={salesEvery === 60 ? "60" : "30"}
                onChange={(value) => {
                  if (value === "30" || value === "60") changeEvery(value === "60" ? 60 : 30);
                }}
              />
            ) : null
          }
        />
      ))}
    </NoticeList>
  );
}

/** Mesma tela, com as linhas da vendedora. As quatro desligadas = nenhum aviso. */
function SellerNotices() {
  const session = useActiveSession();
  const [prefs, setPrefs] = useState<SellerPrefs>(SELLER_DEFAULTS);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    void (async () => {
      const { data: auth } = await sb.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || !live) return;
      setUserId(uid);
      const { data, error } = await sb
        .from("notification_pref")
        .select("seller_goal, seller_challenge, seller_wallet, seller_near, seller_plan")
        .eq("auth_user_id", uid)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();
      if (!live) return;
      if (error) {
        setError("Não foi possível carregar as notificações. Tente novamente.");
        return;
      }
      if (!data) return;
      setPrefs({
        goal: data.seller_goal !== false,
        challenge: data.seller_challenge !== false,
        wallet: data.seller_wallet !== false,
        near: data.seller_near !== false,
        plan: data.seller_plan !== false,
      });
    })();
    return () => {
      live = false;
    };
  }, [session.tenantId]);

  async function persist(next: SellerPrefs) {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const prev = prefs;
    setPrefs(next);
    setError(null);
    const { error } = await sb.from("notification_pref").upsert(
      {
        auth_user_id: userId,
        tenant_id: session.tenantId,
        seller_goal: next.goal,
        seller_challenge: next.challenge,
        seller_wallet: next.wallet,
        seller_near: next.near,
        seller_plan: next.plan,
      },
      { onConflict: "auth_user_id,tenant_id" },
    );
    if (error) {
      setPrefs(prev);
      setError("Não foi possível salvar as alterações. Tente novamente.");
    }
  }

  return (
    <NoticeList error={error}>
      {SELLER_ROWS.map((row) => (
        <NoticeRow key={row.key} name={row.name} desc={row.desc} on={prefs[row.key]} onToggle={() => void persist({ ...prefs, [row.key]: !prefs[row.key] })} />
      ))}
    </NoticeList>
  );
}

/** Conta > Notificações. Gestor e gerente veem os avisos da loja. A vendedora vê os dela. */
export function NotificationsPage() {
  const session = useActiveSession();
  if (session.role === "SELLER") return <SellerNotices />;
  return <StaffNotices />;
}
