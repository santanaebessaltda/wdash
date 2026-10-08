import type { ReactNode } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import type { BlockState as BlockStateTipo } from "@/data/wedash/dashboard";

const ROTULO_ESTADO: Record<Exclude<BlockStateTipo, "disponivel">, string> = {
  carregando: "Carregando dados…",
  sem_dados: "Sem dados no período selecionado.",
  indisponivel: "Bloco indisponível no momento",
};

/** Skeleton / empty / conteudo conforme o estado do bloco. */
export function BlockState({ estado, children }: { estado: BlockStateTipo; children: ReactNode }) {
  if (estado === "disponivel") return <>{children}</>;
  if (estado === "carregando") {
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
      title={ROTULO_ESTADO[estado]}
      description={estado === "sem_dados" ? "Não existem vendas para o período selecionado." : "Tente outro período ou consulte a equipe de TI."}
    />
  );
}
