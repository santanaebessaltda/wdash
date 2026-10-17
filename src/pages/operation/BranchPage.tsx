import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, Card, FormField, Input, Segmented, Select, useToast } from "@/components/ui";
import { paths } from "@/router/paths";
import { type RentSeason } from "@/data/wedash/rentSeason";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { fetchCostTables, updateStoreCostTable, updateStoreCosts, updateStorePointType, type CostTable, type PointType, type Store } from "@/data/wedash/stores";
import { syncProductsNow } from "@/data/wedash/productCatalog";
import { CostFieldsCard, INVALID_COSTS_MSG, pctField, useCostFields, type CostField, type CostFieldSection } from "./costFields";
import { StoreHoursCard } from "./StoreSchedule";
import { BlockTitle, FormActions, NumberField, SAVE_ERROR_MSG, StoreCardsPage, parseNum, useScopedStores } from "./shared";

const RENT_MIN: CostField = {
  key: "rentMin",
  label: "Aluguel mínimo mensal",
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
  "O aluguel do mês é o maior valor entre o mínimo daquele mês e o percentual sobre o faturamento informado ao shopping.\n\nEx.: mínimo de R$ 10.000 em dezembro a 2× e 10% sobre R$ 180.000 resulta em R$ 20.000.";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const SETTINGS_PAGES = {
  branch: { title: "Filial", subtitle: "Defina o tipo desta filial." },
  hours: { title: "Funcionamento", subtitle: "Defina o fuso e o horário de funcionamento desta filial." },
  royalties: { title: "Royalties e marketing", subtitle: "Configure os percentuais de royalties e taxa de marketing." },
  rent: { title: "Aluguel", subtitle: "Configure a regra de aluguel desta filial." },
  products: { title: "Custo dos produtos", subtitle: "Escolha a tabela de custo dos produtos desta filial." },
} as const;

type SettingsSection = keyof typeof SETTINGS_PAGES;

function settingsSection(pathname: string): SettingsSection {
  if (pathname.startsWith(paths.operation.hours)) return "hours";
  if (pathname.startsWith(paths.operation.royalties)) return "royalties";
  if (pathname.startsWith(paths.operation.rentPage)) return "rent";
  if (pathname.startsWith(paths.operation.productsTaxes)) return "products";
  return "branch";
}

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

/** Uma tela de Configurações por aba do menu. */
export function BranchPage() {
  const { pathname } = useLocation();
  const section = settingsSection(pathname);
  const page = SETTINGS_PAGES[section];
  const { storeRows, loading, refresh } = useScopedStores();
  const [tables, setTables] = useState<CostTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState(false);

  useEffect(() => {
    if (section !== "products") return;
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
  }, [section]);

  return (
    <StoreCardsPage
      section="Configurações"
      title={page.title}
      subtitle={page.subtitle}
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} title schedule={section === "hours"} fields={section === "rent" ? 3 : 1} />}
      storeRows={storeRows}
      oneStore
    >
      {(store) => (
        <BranchSection
          section={section}
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

function BranchSection({
  section,
  store,
  tables,
  tablesLoading,
  tablesError,
  onSaved,
}: {
  section: SettingsSection;
  store: Store;
  tables: CostTable[];
  tablesLoading: boolean;
  tablesError: boolean;
  onSaved: () => void;
}) {
  const { show } = useToast();
  const [point, setPoint] = useState<PointType>(store.pointType);
  const [savingPoint, setSavingPoint] = useState(false);
  const pointDirty = point !== store.pointType;

  function escolher(next: PointType) {
    if (next === point || savingPoint) return;
    setPoint(next);
  }

  function resetarTipo() {
    if (!pointDirty || savingPoint) return;
    setPoint(store.pointType);
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

  if (section === "hours") return <StoreHoursCard store={store} canEdit onSaved={onSaved} pointType={store.pointType} />;
  if (section === "royalties") {
    return (
      <CostFieldsCard
        store={store}
        title="Royalties e marketing"
        tip={FRANCHISE_TIP}
        fields={franchiseFields(store)}
        sections={franchiseSections(store)}
        onSaved={onSaved}
      />
    );
  }
  if (section === "rent") return <Card><RentCard store={store} onSaved={onSaved} /></Card>;
  if (section === "products") {
    return (
      <Card>
        <CostTableCard store={store} tables={tables} tablesLoading={tablesLoading} tablesError={tablesError} onSaved={onSaved} />
      </Card>
    );
  }

  return (
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

type SeasonDraft = { key: string; kind: "year" | "once"; month: string; yearMonth: string; factor: string };

function seasonDrafts(seasons: RentSeason[]): SeasonDraft[] {
  return seasons.map((season, index) => ({
    key: `${index}-${season.yearMonth ?? season.month}`,
    kind: season.yearMonth ? "once" : "year",
    month: String(season.month ?? 12),
    yearMonth: season.yearMonth ?? "",
    factor: String(season.factor).replace(".", ","),
  }));
}

function seasonsFromDraft(rows: SeasonDraft[]): RentSeason[] | null {
  const out: RentSeason[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const factor = parseNum(row.factor);
    if (factor == null || factor <= 0) return null;
    if (row.kind === "once") {
      if (!/^\d{4}-\d{2}$/.test(row.yearMonth) || seen.has(row.yearMonth)) return null;
      seen.add(row.yearMonth);
      out.push({ month: null, yearMonth: row.yearMonth, factor });
    } else {
      const month = Number(row.month);
      const key = `m${month}`;
      if (month < 1 || month > 12 || seen.has(key)) return null;
      seen.add(key);
      out.push({ month, yearMonth: null, factor });
    }
  }
  return out;
}

function RentCard({ store, onSaved }: { store: Store; onSaved: () => void }) {
  const { show } = useToast();
  const form = useCostFields(store, RENT_FIELDS);
  const savedSeasons = store.costs?.rentSeasons ?? [];
  const [seasons, setSeasons] = useState<SeasonDraft[]>(() => seasonDrafts(savedSeasons));
  const [saving, setSaving] = useState(false);
  const street = store.pointType === "STREET";
  const fields = street ? [RENT_MIN] : RENT_FIELDS;
  const pctSaved = parseNum(form.saved[RENT_PCT.key] ?? "");
  const removePct = street && pctSaved != null && pctSaved > 0;
  const seasonsDirty = JSON.stringify(seasonsFromDraft(seasons)) !== JSON.stringify(savedSeasons);

  function reset() {
    form.reset();
    setSeasons(seasonDrafts(savedSeasons));
  }

  async function save() {
    const merged = form.merged();
    if (!merged) return show(INVALID_COSTS_MSG, "danger");
    const nextSeasons = street ? savedSeasons : seasonsFromDraft(seasons);
    if (!nextSeasons) return show("Confira a sazonalidade. Informe o mês e um fator maior que zero, sem repetir o mesmo mês.", "danger");
    const costs = { ...(street ? RENT_PCT.set(merged, null) : merged), rentSeasons: nextSeasons };
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
              hint={street || f.key !== RENT_PCT.key ? f.hint : "Percentual sobre o faturamento informado ao shopping."}
              unit={f.unit}
              value={form.txt[f.key] ?? ""}
              onChange={(v) => form.setField(f.key, v)}
            />
          ))}
        </div>
        {!street && (
          <>
            <p className="text-[12.5px] text-t2">
              Base do percentual: faturamento informado ao shopping. Dia ainda não informado usa o faturamento da filial.
            </p>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-t0">Sazonalidade do aluguel mínimo</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSeasons((rows) => [...rows, { key: String(Date.now()), kind: "year", month: "12", yearMonth: "", factor: "2" }])
                  }
                >
                  Adicionar exceção
                </Button>
              </div>
              {seasons.length === 0 ? (
                <p className="text-[12.5px] text-t2">Meses sem exceção usam 1× o aluguel mínimo.</p>
              ) : (
                seasons.map((row) => (
                  <div key={row.key} className="grid grid-cols-1 gap-3 rounded-[13px] border border-line p-3 sm:grid-cols-[160px_1fr_120px_auto] sm:items-end">
                    <FormField label="Repetição">
                      <Select
                        value={row.kind}
                        onChange={(event) =>
                          setSeasons((rows) => rows.map((item) => (item.key === row.key ? { ...item, kind: event.target.value === "once" ? "once" : "year" } : item)))
                        }
                      >
                        <option value="year">Todo ano</option>
                        <option value="once">Mês específico</option>
                      </Select>
                    </FormField>
                    {row.kind === "year" ? (
                      <FormField label="Mês">
                        <Select
                          value={row.month}
                          onChange={(event) => setSeasons((rows) => rows.map((item) => (item.key === row.key ? { ...item, month: event.target.value } : item)))}
                        >
                          {MONTHS.map((name, index) => (
                            <option key={name} value={String(index + 1)}>
                              {name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    ) : (
                      <FormField label="Mês">
                        <Input
                          type="month"
                          value={row.yearMonth}
                          onChange={(event) => setSeasons((rows) => rows.map((item) => (item.key === row.key ? { ...item, yearMonth: event.target.value } : item)))}
                        />
                      </FormField>
                    )}
                    <FormField label="Fator" hint="2 dobra o mínimo.">
                      <Input
                        value={row.factor}
                        inputMode="decimal"
                        onChange={(event) => setSeasons((rows) => rows.map((item) => (item.key === row.key ? { ...item, factor: event.target.value } : item)))}
                      />
                    </FormField>
                    <Button type="button" size="sm" variant="outline" onClick={() => setSeasons((rows) => rows.filter((item) => item.key !== row.key))}>
                      Remover
                    </Button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
        <FormActions dirty={form.dirty || seasonsDirty} saving={saving} onReset={reset} />
      </form>
    </>
  );
}

export default BranchPage;
