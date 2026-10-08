import { useState } from "react";
import { Alert, AlertLink, useToast } from "@/components/ui";
import type { ProductWithoutCost } from "@/data/wedash/dashboard";
import { syncProductsNow } from "@/data/wedash/productCatalog";
import { isGestor } from "@/layout/nav-wedash";
import { brlCent, num } from "@/lib/format";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";

/**
 * Aviso (warn) quando produtos vendidos no periodo ficam sem custo: R$ 0 na margem do Millennium
 * e sem preco na tabela de custo da loja  -  CMV e margem ficam otimistas.
 * "Atualizar custos" (Gestor): depois que o custo e cadastrado no Millennium, busca de novo a tabela
 * de custo e a margem das lojas afetadas no periodo da tela.
 */
export function ProductsWithoutCostNotice({
  produtos,
  storeIds,
  from,
  to,
}: {
  produtos?: ProductWithoutCost[];
  storeIds: string[];
  from: string;
  to: string;
}) {
  const session = useActiveSession();
  const { show } = useToast();
  const [aberto, setAberto] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  if (!produtos || produtos.length === 0) return null;
  const n = produtos.length;

  async function atualizarCustos() {
    if (atualizando) return;
    setAtualizando(true);
    const r = await syncProductsNow({ scope: "costs", storeIds, from, to });
    setAtualizando(false);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
    if (r.missing === 0) show("Custos atualizados.", "success");
    else
      show(
        r.missing === 1
          ? "O Millennium ainda está sem custo para 1 produto."
          : `O Millennium ainda está sem custo para ${r.missing} produtos.`,
        "warning",
      );
  }

  return (
    <Alert
      variant="warning"
      className="mt-4"
      title={n === 1 ? "1 produto está sem custo no Millennium." : `${n} produtos estão sem custo no Millennium.`}
      action={
        <>
          <AlertLink onClick={() => setAberto((v) => !v)}>{aberto ? "Ocultar" : "Ver produtos"}</AlertLink>
          {isGestor(session.role) && (
            <AlertLink
              onClick={() => void atualizarCustos()}
              disabled={atualizando}
              title="Depois de cadastrar os custos no Millennium, atualize para buscar os novos valores."
            >
              {atualizando ? "Atualizando…" : "Atualizar custos"}
            </AlertLink>
          )}
        </>
      }
      footer={
        aberto && (
          <ul className="mt-2.5 divide-y divide-warn/20 border-t border-warn/20 text-[12.5px] text-t0">
            {produtos.map((p) => (
              <li key={p.code} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-t2">{p.code}</span>
                  {p.name ? <span> · {p.name}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-t1">
                  {num(p.items)} {p.items === 1 ? "item" : "itens"} · {brlCent(p.revenue)}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    >
      Isso pode deixar o CMV e a margem incorretos.
    </Alert>
  );
}
