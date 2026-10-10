import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { enableSalesPush, refreshSalesPush } from "./salesPush";

/** Sino do topo. some depois que a pessoa permite os avisos de vendas. */
export function SalesPushButton({ tenantId }: { tenantId: string }) {
  const { show } = useToast();
  const [visivel, setVisivel] = useState(() => typeof Notification !== "undefined" && Notification.permission === "default");

  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    void refreshSalesPush(tenantId);
  }, [tenantId]);

  if (!visivel) return null;

  return (
    <button
      type="button"
      title="Receber o resumo de vendas a cada atualização"
      aria-label="Ativar avisos de vendas"
      className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-2.5 text-[12px] font-bold text-t1 hover:border-acc hover:text-t0"
      onClick={() => {
        void enableSalesPush(tenantId).then((r) => {
          if (r === "ok") {
            setVisivel(false);
            show("Avisos de vendas ativados.", "success");
          } else if (r === "denied") show("O navegador bloqueou os avisos. Libere as notificações da WDash.", "warning");
          else show("Este aparelho não recebe avisos. No iPhone, instale a WDash na Tela de Início.", "warning");
        });
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span className="hidden sm:inline">Avisos</span>
    </button>
  );
}
