import { useEffect, useState } from "react";
import { Card, FormField, Segmented, Select, useToast } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { fetchCostTables, updateStoreCostTable, updateStoreCosts, updateStorePointType, type CostTable, type PointType, type Store } from "@/data/wedash/stores";
import { syncProductsNow } from "@/data/wedash/productCatalog";
import { CostFieldsCard, INVALID_COSTS_MSG, pctField, useCostFields, type CostField, type CostFieldSection } from "./costFields";
import { StoreHoursCard } from "./StoreSchedule";
import { BlockTitle, FormActions, NumberField, SAVE_ERROR_MSG, StoreCardsPage, parseNum, useScopedStores } from "./shared";

const RENT_MIN: CostField = {
  key: "rentMin",
  label: "Aluguel mensal",
  unit: "R$",
  get: (c) => c.rentMin,
  set: (c, v) => ({ ...c, rentMin: v }),
};

/** Aluguel % vale para a loja toda: grava igual nas duas marcas. */
const RENT_PCT: CostField = {
  key: "rentPct",
  label: "Aluguel percentual",
  unit: "%",
  get: (c) => c.rentWepinkPct ?? c.rentWpinkPct,
  set: (c, v) => ({ ...c, rentWepinkPct: v, rentWpinkPct: v }),
};

const RENT_FIELDS = [RENT_MIN, RENT_PCT];

const POINT_OPTIONS: { value: PointType; label: string }[] = [
  { value: "SHOPPING", label: "Quiosque em shopping" },
  { value: "STREET", label: "Loja de rua" },
];

const RENT_TIP =
  "A WDash considera o maior valor entre o aluguel mensal e o percentual sobre o faturamento.\n\nEx.: aluguel de R$ 10.000 e 10% sobre R$ 120.000 resulta em R$ 12.000.";

const FRANCHISE_TIP =
  "Os percentuais são calculados sobre o faturamento de cada marca e entram no resultado operacional. Campos vazios são considerados 0%.";

const COST_TABLE_TIP =
  "Sem uma tabela definida, a WDash escolhe automaticamente a que mais se aproxima dos custos da filial. Ao escolher uma tabela, ela passa a ser usada como referência do CMV.";

const COST_TABLE_SYNC_ERROR = "Não foi possível atualizar a tabela de custo no Millennium. Nada foi alterado.";

function franchiseFields(store: Store): CostField[] {
  return [
    pctField("royaltiesWepinkPct", "Royalties"),
    pctField("marketingWepinkPct", "Taxa de marketing"),
    ...(store.hasWpink ? [pctField("royaltiesWpinkPct", "Royalties"), pctField("marketingWpinkPct", "Taxa de marketing")] : []),
  ];
}

function franchiseSections(store: Store): CostFieldSection[] {
  return [
    { title: "WEPINK", keys: ["royaltiesWepinkPct", "marketingWepinkPct"] },
    ...(store.hasWpink ? [{ title: "WPINK", keys: ["royaltiesWpinkPct", "marketingWpinkPct"] }] : []),
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
      subtitle="Configure os dados operacionais e os custos desta filial."
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
    <div className="flex flex-col gap-4">
      <Card>
        <BlockTitle title="Filial" />
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void salvarTipo();
          }}
        >
          <p className="text-[12.5px] text-t2">O tipo da filial define o horário padrão e as opções de aluguel.</p>
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
        title="Royalties e marketing"
        tip={FRANCHISE_TIP}
        fields={franchiseFields(store)}
        sections={franchiseSections(store)}
        onSaved={onSaved}
      />
      <Card>
        <RentCard store={store} point={point} onSaved={onSaved} />
      </Card>
      <Card>
        <CostTableCard store={store} tables={tables} tablesLoading={tablesLoading} tablesError={tablesError} onSaved={onSaved} />
      </Card>
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
        return show(COST_TABLE_SYNC_ERROR, "danger");
      }
    }
    const r = await updateStoreCostTable(store.id, table);
    setSaving(false);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    setSavedTable(table);
    onSaved();
    show("Alterações salvas.", "success");
  }

  const noTables = !tablesLoading && !tablesError && tables.length === 0 && table == null;

  return (
    <>
      <BlockTitle title="Custo dos produtos" tip={COST_TABLE_TIP} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FormField label="Tabela de custo" hint="Usada quando uma venda chega sem custo do produto.">
          <Select
            value={tablesLoading || table == null ? "" : String(table)}
            disabled={tablesLoading || noTables}
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
        {noTables && <p className="text-[12.5px] text-t2">Nenhuma tabela de custo disponível.</p>}
        {tablesError && (
          <p className="text-[12.5px] font-semibold text-bad">Não foi possível buscar as tabelas de custo. Tente novamente.</p>
        )}
        <FormActions dirty={tableDirty} saving={saving} onReset={() => setTable(savedTable)} />
      </form>
    </>
  );
}

function RentCard({ store, point, onSaved }: { store: Store; point: PointType; onSaved: () => void }) {
  const { show } = useToast();
  const form = useCostFields(store, RENT_FIELDS);
  const [saving, setSaving] = useState(false);
  const street = point === "STREET";
  const fields = street ? [RENT_MIN] : RENT_FIELDS;
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
    <>
      <BlockTitle title="Aluguel" tip={street ? undefined : RENT_TIP} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {removePct && (
          <p className="text-[12px] font-semibold text-warn">O aluguel percentual será removido ao salvar as alterações.</p>
        )}
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
    </>
  );
}

export default BranchPage;
