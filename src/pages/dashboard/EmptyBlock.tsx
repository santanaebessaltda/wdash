import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui";

/** Vazio padrao dos cards do Dashboard (EmptyState do Vela, sem borda propria).
 *  Sem dados = ; filtro/busca sem resultado =  + acao de limpar.
 *  O card precisa ser `flex flex-col` para o bloco preencher a altura da linha da grade. */
export function EmptyBlock({
  icon = "📊",
  title = "Sem dados no período",
  description = "Nenhuma venda registrada no período selecionado.",
  action,
}: {
  icon?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return <EmptyState icon={icon} title={title} description={description} action={action} framed={false} className="flex-1" />;
}
