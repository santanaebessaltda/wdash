import { useEffect, useState } from "react";
import { Card, FormField, Select, useToast } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { fetchCostTables, updateStoreCosts, updateStoreCostTable, type CostTable, type Store } from "@/data/wedash/stores";
import { syncProductsNow } from "@/data/wedash/productCatalog";
import { INVALID_COSTS_MSG, pctField, useCostFields, type CostField, type CostFieldSection } from "./costFields";
import { CostCardTitle, FormActions, NumberField, SAVE_ERROR_MSG, StoreCardsPage, useScopedStores } from "./shared";

function taxFields(loja: Store): CostField[] {
  return [
    pctField("icmsWepinkPct", "ICMS"),
    pctField("icmsStWepinkPct", "ICMS ST"),
    ...(loja.temWpink ? [pctField("icmsWpinkPct", "ICMS"), pctField("icmsStWpinkPct", "ICMS ST")] : []),
  ];
}

function taxSections(loja: Store): CostFieldSection[] {
  return [
    {
      title: "WEPINK",
      hint: "ICMS é calculado sobre o faturamento WEPINK. ICMS ST é calculado sobre o CMV WEPINK.",
      keys: ["icmsWepinkPct", "icmsStWepinkPct"],
    },
    ...(loja.temWpink
      ? [
          {
            title: "WPINK",
            hint: "ICMS é calculado sobre o faturamento WPINK. ICMS ST é calculado sobre o CMV WPINK.",
            keys: ["icmsWpinkPct", "icmsStWpinkPct"],
          },
        ]
      : []),
  ];
}

const TAX_INTRO = "ICMS e ICMS ST são considerados no cálculo do lucro bruto e da margem de cada marca. Campos vazios são considerados 0%.";

/** Configuracoes > Produtos e impostos  -  tabela de custo do Millennium, ICMS e ICMS ST. */
export function ProductsTaxesPage() {
  const { lojas, loading, refresh } = useScopedStores();
  const [tables, setTables] = useState<CostTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCostTables().then((list) => {
      if (cancelled) return;
      setTablesError(list == null);
      setTables(list ?? []);
      setTablesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StoreCardsPage
      section="Configurações"
      title="Produtos e impostos"
      subtitle="Configure a tabela de custo dos produtos e os impostos da filial."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} title intro fields={1} sections={1} />}
      lojas={lojas}
      oneStore
    >
      {(loja) => (
        <div className="flex flex-col gap-5">
          <CostTableCard loja={loja} tables={tables} tablesLoading={tablesLoading} tablesError={tablesError} onSaved={refresh} />
          <TaxCard loja={loja} onSaved={refresh} />
        </div>
      )}
    </StoreCardsPage>
  );
}

function CostTableCard({
  loja,
  tables,
  tablesLoading,
  tablesError,
  onSaved,
}: {
  loja: Store;
  tables: CostTable[];
  tablesLoading: boolean;
  tablesError: boolean;
  onSaved: () => void;
}) {
  const { show } = useToast();
  const [savedTable, setSavedTable] = useState<number | null>(loja.costTableId ?? null);
  const [table, setTable] = useState<number | null>(savedTable);
  const [saving, setSaving] = useState(false);
  const tableDirty = table !== savedTable;

  /** Tabela nova busca os precos no Millennium antes; falhou = nada e gravado. */
  async function save() {
    setSaving(true);
    if (table != null) {
      const prices = await syncProductsNow({ scope: "table", tableId: table });
      if (!prices.ok) {
        setSaving(false);
        return show(prices.message, "danger");
      }
    }
    const r = await updateStoreCostTable(loja.id, table);
    setSaving(false);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    setSavedTable(table);
    onSaved();
    show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <CostCardTitle title="Custo dos produtos" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FormField
          label="Tabela de custo dos produtos"
          hint="Usada quando um produto vendido chega do Millennium sem custo. Enquanto nenhuma tabela for escolhida manualmente, a WDash seleciona automaticamente a que mais se aproxima dos custos da filial."
        >
          <Select
            value={tablesLoading || table == null ? "" : String(table)}
            disabled={tablesLoading}
            onChange={(e) => setTable(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{tablesLoading ? "Buscando tabelas no Millennium…" : "Nenhuma tabela"}</option>
            {!tablesLoading && table != null && !tables.some((t) => t.id === table) && (
              <option value={String(table)}>Tabela {table} · indisponível</option>
            )}
            {tables.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {`Tabela ${t.code || t.id}`}
              </option>
            ))}
          </Select>
        </FormField>
        {tablesError && (
          <p className="text-[12.5px] font-semibold text-bad">Não foi possível buscar as tabelas de custo. Tente novamente.</p>
        )}
        <FormActions dirty={tableDirty} saving={saving} onReset={() => setTable(savedTable)} />
      </form>
    </Card>
  );
}

function TaxCard({ loja, onSaved }: { loja: Store; onSaved: () => void }) {
  const { show } = useToast();
  const fields = taxFields(loja);
  const form = useCostFields(loja, fields);
  const [saving, setSaving] = useState(false);

  async function save() {
    const custos = form.merged();
    if (!custos) return show(INVALID_COSTS_MSG, "danger");
    setSaving(true);
    const r = await updateStoreCosts(loja.id, custos);
    setSaving(false);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    form.markSaved(custos);
    onSaved();
    show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <CostCardTitle title="Impostos" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[12.5px] text-t2">{TAX_INTRO}</p>
        {taxSections(loja).map((section) => (
          <div key={section.title} className="flex flex-col gap-3">
            <div>
              <p className="text-[14px] font-bold text-t0">{section.title}</p>
              {section.hint && <p className="mt-0.5 text-[12.5px] text-t2">{section.hint}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields
                .filter((f) => section.keys.includes(f.key))
                .map((f) => (
                  <NumberField
                    key={f.key}
                    label={f.label}
                    hint={f.hint}
                    unit={f.unit}
                    value={form.txt[f.key] ?? ""}
                    onChange={(v) => form.setField(f.key, v)}
                  />
                ))}
            </div>
          </div>
        ))}
        <FormActions dirty={form.dirty} saving={saving} onReset={form.reset} />
      </form>
    </Card>
  );
}

export default ProductsTaxesPage;
