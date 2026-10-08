import { Alert, Card } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { weekHoursConfigured } from "@/data/wedash/storeHours";
import { StoreCardHeader, StoreCardsPage, useScopedStores } from "./shared";
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
      skeleton={(n) => <StoreCardsSkeleton count={n} schedule />}
      lojas={lojas}
    >
      {(loja) => (
        <Card>
          <StoreCardHeader loja={loja} />
          <div className="mb-4">
            <p className="text-[14px] font-bold text-t0">Funcionamento</p>
            <p className="mt-0.5 text-[12.5px] text-t2">
              Define quando as vendas são atualizadas automaticamente. Também organiza as vendas por hora nos gráficos e
              distribui a meta do dia pelas horas.
            </p>
          </div>
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
