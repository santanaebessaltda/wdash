import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import type { Store } from "@/data/wedash/stores";
import { CostFieldsCard, pctField, type CostField, type CostFieldSection } from "./costFields";
import { StoreCardsPage, useScopedStores } from "./shared";

const INTRO =
  "Esses percentuais entram nos custos da operação e são considerados no cálculo do resultado operacional no Financeiro. Campos vazios são considerados 0%.";

/** WPINK so aparece para loja que vende a marca. */
function franchiseFields(loja: Store): CostField[] {
  return [
    pctField("royaltiesWepinkPct", "Royalties WEPINK"),
    pctField("marketingWepinkPct", "Taxa de marketing WEPINK"),
    ...(loja.temWpink
      ? [pctField("royaltiesWpinkPct", "Royalties WPINK"), pctField("marketingWpinkPct", "Taxa de marketing WPINK")]
      : []),
  ];
}

function franchiseSections(loja: Store): CostFieldSection[] {
  return [
    {
      title: "WEPINK",
      hint: "Royalties e taxa de marketing são calculados sobre o faturamento WEPINK.",
      keys: ["royaltiesWepinkPct", "marketingWepinkPct"],
    },
    ...(loja.temWpink
      ? [
          {
            title: "WPINK",
            hint: "Royalties e taxa de marketing são calculados sobre o faturamento WPINK.",
            keys: ["royaltiesWpinkPct", "marketingWpinkPct"],
          },
        ]
      : []),
  ];
}

/** Configuracoes > Franquia  -  royalties e taxa de marketing por marca. */
export function FranchisePage() {
  const { lojas, loading, refresh } = useScopedStores();
  return (
    <StoreCardsPage
      section="Custos"
      title="Franquia"
      subtitle="Configure royalties e taxa de marketing pagos à franqueadora."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} sections={1} />}
      lojas={lojas}
    >
      {(loja) => (
        <CostFieldsCard
          loja={loja}
          fields={franchiseFields(loja)}
          intro={INTRO}
          sections={franchiseSections(loja)}
          onSaved={refresh}
        />
      )}
    </StoreCardsPage>
  );
}

export default FranchisePage;
