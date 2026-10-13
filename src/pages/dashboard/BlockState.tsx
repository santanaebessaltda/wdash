import type { ReactNode } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import type { BlockState as BlockStateKind } from "@/data/wedash/dashboard";

const STATE_LABEL: Record<Exclude<BlockStateKind, "available">, string> = {
  loading: "Carregando dados…",
  noData: "Sem dados no período selecionado.",
  unavailable: "Bloco indisponível no momento",
};

/** Skeleton / empty / conteudo conforme o estado do bloco. */
export function BlockState({ status, children }: { status: BlockStateKind; children: ReactNode }) {
  if (status === "available") return <>{children}</>;
  if (status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <EmptyState
      icon="📭"
      title={STATE_LABEL[status]}
      description={status === "noData" ? "Não existem vendas para o período selecionado." : "Tente outro período ou consulte a equipe de TI."}
    />
  );
}
