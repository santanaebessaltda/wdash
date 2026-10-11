import { Alert, Card } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { weekHoursConfigured } from "@/data/wedash/storeHours";
import { CostCardTitle, StoreCardsPage, useScopedStores } from "./shared";
import { StoreScheduleForm } from "./StoreSchedule";

/** Configuracoes > Loja  -  funcionamento (fuso + horario) de cada loja; posiciona as vendas por hora nos graficos. */
export function StorePage() {
  const { lojas, loading, refresh } = useScopedStores();
  return (
    <StoreCardsPage
      section="Operação"
      title="Funcionamento"
      subtitle="Configure o fuso horário e o funcionamento de cada loja."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} title schedule />}
      lojas={lojas}
      oneStore
    >
      {(loja) => (
        <Card>
          <CostCardTitle title="Horário de funcionamento" />
          <p className="mb-4 text-[12.5px] text-t2">
            Define quando as vendas são atualizadas automaticamente. Também organiza as vendas por hora nos gráficos e
            distribui a meta do dia pelas horas.
          </p>
          {!weekHoursConfigured(loja.horas) && (
            <Alert variant="warning" className="mb-4" title="Horário de funcionamento não configurado">
              Sem o horário configurado, as vendas desta loja só são atualizadas pelo botão Atualizar.
            </Alert>
          )}
          <StoreScheduleForm store={loja} canEdit onSaved={refresh} />
        </Card>
      )}
    </StoreCardsPage>
  );
}

export default StorePage;
