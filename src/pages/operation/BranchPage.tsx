import { useEffect, useState } from "react";
import { Card, FormField, Segmented, Select, useToast } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { fetchCostTables, updateStoreCostTable, updateStoreCosts, updateStorePointType, type CostTable, type PointType, type Store } from "@/data/wedash/stores";
import { syncProductsNow } from "@/data/wedash/productCatalog";
import { CostFieldsCard, INVALID_COSTS_MSG, pctField, useCostFields, type CostField, type CostFieldSection } from "./costFields";
import { StoreHoursCard } from "./StoreSchedule";
import { CostCardTitle, FormActions, NumberField, SAVE_ERROR_MSG, StoreCardsPage, parseNum, useScopedStores } from "./shared";

const RENT_MIN: CostField = {
  key: "rentMin",
  label: "Aluguel",
  hint: "Valor mensal.",
  unit: "R$",
  get: (c) => c.rentMin,
  set: (c, v) => ({ ...c, rentMin: v }),
};

/** Aluguel % vale para a loja toda: grava igual nas duas marcas. */
const RENT_PCT: CostField = {
  key: "rentPct",
  label: "Aluguel percentual",
  hint: "Percentual sobre o faturamento total.",
  unit: "%",
  get: (c) => c.rentWepinkPct ?? c.rentWpinkPct,
  set: (c, v) => ({ ...c, rentWepinkPct: v, rentWpinkPct: v }),
};

const RENT_FIELDS = [RENT_MIN, RENT_PCT];

const POINT_OPTIONS: { value: PointType; label: string }[] = [
  { value: "SHOPPING", label: "Quiosque em shopping" },
  { value: "STREET", label: "Loja de rua" },
];

const RENT_HINT: Record<PointType, string[]> = {
  SHOPPING: [
    "A WDash considera o maior valor entre o aluguel mensal e o aluguel percentual. Quando o percentual for maior, somente o valor excedente é acrescentado ao aluguel mensal.",
    "Exemplo: com aluguel mensal de R$ 10.000,00 e aluguel percentual de 10% sobre R$ 120.000,00 de faturamento, o aluguel considerado será de R$ 12.000,00. Os R$ 2.000,00 adicionais correspondem ao aluguel percentual excedente.",
    "No mês em andamento, a comparação considera o aluguel mensal proporcional aos dias já passados.",
  ],
  STREET: ["Na loja de rua, a WDash considera somente o aluguel mensal."],
};

const FRANCHISE_INTRO =
  "Esses percentuais entram nos custos da operação e são considerados no cálculo do resultado operacional no Financeiro. Campos vazios são considerados 0%.";

function franchiseFields(store: Store): CostField[] {
  return [
    pctField("royaltiesWepinkPct", "Royalties WEPINK"),
    pctField("marketingWepinkPct", "Taxa de marketing WEPINK"),
    ...(store.hasWpink
      ? [pctField("royaltiesWpinkPct", "Royalties WPINK"), pctField("marketingWpinkPct", "Taxa de marketing WPINK")]
      : []),
  ];
}

function franchiseSections(store: Store): CostFieldSection[] {
  return [
    {
      title: "WEPINK",
      hint: "Royalties e taxa de marketing são calculados sobre o faturamento WEPINK.",
      keys: ["royaltiesWepinkPct", "marketingWepinkPct"],
    },
    ...(store.hasWpink
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

/** Configurações. Tipo, funcionamento, custos e tabela de custo da filial. */
export function BranchPage() {
  const { storeRows, loading, refresh } = useScopedStores();
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
      title="Configurações"
      subtitle="Configure o tipo, o funcionamento, os custos e a tabela de custo desta filial."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} title schedule sections={2} fields={1} />}
      storeRows={storeRows}
      oneStore
    >
      {(store) => (
        <BranchCards
          store={store}
          tables={tables}
          tablesLoading={tablesLoading}
          tablesError={tablesError}
          onSaved={refresh}
        />
      )}
    </StoreCardsPage>
  );
}

function BranchCards({
  store,
  tables,
  tablesLoading,
  tablesError,
  onSaved,
}: {
  store: Store;
  tables: CostTable[];
  tablesLoading: boolean;
  tablesError: boolean;
  onSaved: () => void;
}) {
  const { show } = useToast();
  const [point, setPoint] = useState<PointType>(store.pointType);
  const [savingPoint, setSavingPoint] = useState(false);
  const [presetStamp, setPresetStamp] = useState(0);
  const pointDirty = point !== store.pointType;

  function escolher(next: PointType) {
    if (next === point || savingPoint) return;
    setPoint(next);
    setPresetStamp((n) => n + 1);
  }

  function resetarTipo() {
    if (!pointDirty || savingPoint) return;
    setPoint(store.pointType);
    setPresetStamp((n) => n + 1);
  }

  async function salvarTipo() {
    if (!pointDirty || savingPoint) return;
    setSavingPoint(true);
    const result = await updateStorePointType(store.id, point);
    setSavingPoint(false);
    if (!result.ok) {
      show(SAVE_ERROR_MSG, "danger");
      return;
    }
    onSaved();
    show("Alterações salvas.", "success");
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CostCardTitle title="Filial" />
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void salvarTipo();
          }}
        >
          <p className="text-[12.5px] text-t2">O tipo da filial define o horário sugerido e as opções de aluguel.</p>
          <div>
            <p className="mb-1.5 text-[12.5px] font-bold text-t0">Tipo de filial</p>
            <Segmented options={POINT_OPTIONS} value={point} onChange={(v) => v && escolher(v)} />
          </div>
          <FormActions dirty={pointDirty} saving={savingPoint} onReset={resetarTipo} />
        </form>
      </Card>
      <StoreHoursCard store={store} canEdit onSaved={onSaved} pointType={point} presetStamp={presetStamp} />
      <CostFieldsCard
        store={store}
        title="Royalties e taxa de marketing"
        fields={franchiseFields(store)}
        intro={FRANCHISE_INTRO}
        sections={franchiseSections(store)}
        onSaved={onSaved}
      />
      <RentCard store={store} point={point} onSaved={onSaved} />
      <CostTableCard store={store} tables={tables} tablesLoading={tablesLoading} tablesError={tablesError} onSaved={onSaved} />
    </div>
  );
}

function CostTableCard({
  store,
  tables,
  tablesLoading,
  tablesError,
  onSaved,
}: {
  store: Store;
  tables: CostTable[];
  tablesLoading: boolean;
  tablesError: boolean;
  onSaved: () => void;
}) {
  const { show } = useToast();
  const [savedTable, setSavedTable] = useState<number | null>(store.costTableId ?? null);
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
    const r = await updateStoreCostTable(store.id, table);
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

function RentCard({ store, point, onSaved }: { store: Store; point: PointType; onSaved: () => void }) {
  const { show } = useToast();
  const form = useCostFields(store, RENT_FIELDS);
  const [saving, setSaving] = useState(false);
  const street = point === "STREET";
  const monthly = street ? { ...RENT_MIN, label: "Aluguel mensal" } : RENT_MIN;
  const fields = street ? [monthly] : RENT_FIELDS;
  const pctSaved = parseNum(form.saved[RENT_PCT.key] ?? "");
  const removePct = street && pctSaved != null && pctSaved > 0;

  async function save() {
    const merged = form.merged();
    if (!merged) return show(INVALID_COSTS_MSG, "danger");
    const costs = street ? RENT_PCT.set(merged, null) : merged;
    setSaving(true);
    const r = await updateStoreCosts(store.id, costs);
    setSaving(false);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    form.markSaved(costs);
    onSaved();
    show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <CostCardTitle title="Aluguel" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[12.5px] text-t2">
          Esses valores entram nos custos da operação e são considerados no cálculo do resultado operacional no Financeiro. Campos vazios são considerados 0.
        </p>
        {removePct && (
          <p className="text-[12px] font-semibold text-warn">O aluguel percentual será removido ao salvar as alterações.</p>
        )}
        <div className="flex flex-col gap-1">
          {RENT_HINT[point].map((t) => (
            <p key={t} className="text-[11.5px] text-t2">
              {t}
            </p>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((f) => (
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
        <FormActions dirty={form.dirty} saving={saving} onReset={form.reset} />
      </form>
    </Card>
  );
}

export default BranchPage;
