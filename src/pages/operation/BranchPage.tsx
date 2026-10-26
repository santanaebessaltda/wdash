import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Alert, Button, Card, FormField, Input, Segmented, Select, useToast } from "@/components/ui";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { isOwner } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { type RentSeason } from "@/data/wedash/rentSeason";
import { weekHoursConfigured } from "@/data/wedash/storeHours";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import { fetchCostTables, updateStoreCostTable, updateStoreCosts, updateStorePointType, type CostTable, type PointType, type Store } from "@/data/wedash/stores";
import { syncProductsNow } from "@/data/wedash/productCatalog";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { CostFieldsCard, INVALID_COSTS_MSG, pctField, useCostFields, type CostField, type CostFieldSection } from "./costFields";
import { HOURS_TIP, StoreScheduleForm } from "./StoreSchedule";
import {
  BlockTitle,
  FormActions,
  NumberField,
  SAVE_ERROR_MSG,
  SectionHeader,
  SettingsDraftProvider,
  parseNum,
  useRegisterSettingsDraft,
  useScopedStores,
  useSettingsDraftScope,
  useSettingsDrafts,
} from "./shared";

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

type SettingsSection = "branch" | "hours" | "royalties" | "rent" | "products";

function settingsCopy(section: SettingsSection, many: boolean): { title: string; subtitle: string } {
  const each = many ? "de cada filial" : "desta filial";
  if (section === "hours") return { title: "Funcionamento", subtitle: `Defina o fuso e o horário de funcionamento ${each}.` };
  if (section === "royalties") {
    return {
      title: "Royalties e marketing",
      subtitle: many
        ? "Configure os percentuais de royalties e taxa de marketing de cada filial."
        : "Configure os percentuais de royalties e taxa de marketing.",
    };
  }
  if (section === "rent") return { title: "Aluguel", subtitle: `Configure a regra de aluguel ${each}.` };
  if (section === "products") return { title: "Custo dos produtos", subtitle: `Escolha a tabela de custo dos produtos ${each}.` };
  return { title: "Filial", subtitle: `Defina o tipo ${each}.` };
}

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

function storeName(store: Store): string {
  return store.tradeName || store.name;
}

/** Uma tela de Configurações por aba do menu. As filiais ficam no mesmo card. */
export function BranchPage() {
  const { pathname } = useLocation();
  const session = useActiveSession();
  const canEdit = isOwner(session.role);
  const section = settingsSection(pathname);
  const { storeRows, loading, refresh } = useScopedStores();
  const many = storeRows.length > 1;
  const page = settingsCopy(section, many);
  if (!canEdit && section === "hours") {
    page.subtitle = many ? "Veja o fuso e o horário de funcionamento de cada filial." : "Veja o fuso e o horário de funcionamento desta filial.";
  }
  const drafts = useSettingsDrafts();
  const { show } = useToast();
  const showSkeleton = useMinSkeleton(loading);
  const [tables, setTables] = useState<CostTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState(false);
  const noTables = !tablesLoading && !tablesError && tables.length === 0;

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

  async function saveAll() {
    const result = await drafts.saveAll(storeRows.map((store) => store.id));
    if (result.wrote) refresh();
    if (result.ok && result.wrote) show("Alterações salvas.", "success");
  }

  const tip =
    section === "hours"
      ? HOURS_TIP
      : section === "royalties"
        ? FRANCHISE_TIP
        : section === "products"
          ? COST_TABLE_TIP
          : section === "rent" && storeRows.some((store) => store.pointType !== "STREET")
            ? RENT_TIP
            : undefined;

  return (
    <div>
      <SectionHeader section="Configurações" title={page.title} subtitle={page.subtitle} />
      <div className="mt-6 max-w-[720px]">
        {showSkeleton ? (
          <StoreCardsSkeleton
            count={1}
            title
            intro={section === "branch"}
            schedule={section === "hours"}
            sections={section === "royalties" ? 1 : 0}
            fields={section === "rent" ? 3 : section === "products" || section === "branch" ? 1 : 0}
          />
        ) : storeRows.length === 0 ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <SettingsCard
            canEdit={canEdit}
            title={page.title}
            tip={tip}
            intro={section === "branch" ? "O tipo da filial define o horário padrão e as opções de aluguel." : undefined}
            notice={
              section === "products" && tablesError ? (
                <p className="mb-4 text-[12.5px] font-semibold text-bad">Não foi possível buscar as tabelas de custo. Tente novamente.</p>
              ) : section === "products" && noTables ? (
                <p className="mb-4 text-[12.5px] text-t2">Nenhuma tabela de custo disponível.</p>
              ) : null
            }
            storeRows={storeRows}
            drafts={drafts}
            onSave={saveAll}
          >
            {(store) => {
              if (section === "hours") return <HoursBlock store={store} canEdit={canEdit} />;
              if (section === "royalties") {
                return (
                  <CostFieldsCard
                    store={store}
                    title="Royalties e marketing"
                    fields={franchiseFields(store)}
                    sections={franchiseSections(store)}
                    onSaved={() => {}}
                  />
                );
              }
              if (section === "rent") return <RentBlock store={store} />;
              if (section === "products") return <CostTableBlock store={store} tables={tables} tablesLoading={tablesLoading} />;
              return <PointBlock store={store} />;
            }}
          </SettingsCard>
        )}
      </div>
    </div>
  );
}

function SettingsCard({
  canEdit,
  title,
  tip,
  intro,
  notice,
  storeRows,
  drafts,
  onSave,
  children,
}: {
  canEdit: boolean;
  title: string;
  tip?: string;
  intro?: string;
  notice?: ReactNode;
  storeRows: Store[];
  drafts: ReturnType<typeof useSettingsDrafts>;
  onSave: () => void;
  children: (store: Store) => ReactNode;
}) {
  const many = storeRows.length > 1;
  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <BlockTitle title={title} tip={tip} />
        {intro ? <p className="mb-4 text-[12.5px] text-t2">{intro}</p> : null}
        {notice}
        <div>
          {storeRows.map((store) => {
            const name = storeName(store);
            return (
              <section key={store.id} className={cn("flex flex-col gap-4", many && "border-t border-line pb-6 pt-5 first:border-t-0 first:pt-0")}>
                {many ? <StoreDivisionTitle>{name}</StoreDivisionTitle> : null}
                <SettingsDraftProvider register={drafts.register} errorPrefix={many ? name : undefined}>
                  {children(store)}
                </SettingsDraftProvider>
              </section>
            );
          })}
        </div>
        {canEdit ? (
        <div className={many ? undefined : "mt-4"}>
          <FormActions dirty={drafts.dirty} saving={drafts.saving} onReset={drafts.resetAll} />
        </div>
        ) : null}
      </form>
    </Card>
  );
}

function HoursBlock({ store, canEdit }: { store: Store; canEdit: boolean }) {
  return (
    <>
      {!weekHoursConfigured(store.hours) && (
        <Alert variant="warning" title="Horário não configurado">
          As vendas serão atualizadas apenas pelo botão Atualizar enquanto não houver horário definido.
        </Alert>
      )}
      <StoreScheduleForm store={store} canEdit={canEdit} onSaved={() => {}} />
    </>
  );
}

function PointBlock({ store }: { store: Store }) {
  const { show } = useToast();
  const scope = useSettingsDraftScope();
  const [baseline, setBaseline] = useState(store.pointType);
  const [point, setPoint] = useState<PointType>(store.pointType);
  const dirty = point !== baseline;

  function reset() {
    setPoint(baseline);
  }

  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    const result = await updateStorePointType(store.id, point).catch(() => ({ ok: false as const }));
    if (!result.ok) {
      show(scope?.errorPrefix ? `${scope.errorPrefix}: ${SAVE_ERROR_MSG}` : SAVE_ERROR_MSG, "danger");
      return false;
    }
    setBaseline(point);
    return true;
  }

  useRegisterSettingsDraft(store.id, { dirty, reset, save: persist });

  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-bold text-t0">Tipo de filial</p>
      <Segmented options={POINT_OPTIONS} value={point} onChange={(value) => value && setPoint(value)} />
    </div>
  );
}

function CostTableBlock({
  store,
  tables,
  tablesLoading,
}: {
  store: Store;
  tables: CostTable[];
  tablesLoading: boolean;
}) {
  const { show } = useToast();
  const scope = useSettingsDraftScope();
  const [savedTable, setSavedTable] = useState<number | null>(store.costTableId ?? null);
  const [table, setTable] = useState<number | null>(savedTable);
  const dirty = table !== savedTable;
  const noTables = !tablesLoading && tables.length === 0 && table == null;

  function reset() {
    setTable(savedTable);
  }

  /** Tabela nova busca os preços no Millennium antes; falhou = esta filial não grava. */
  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    const say = (message: string) => show(scope?.errorPrefix ? `${scope.errorPrefix}: ${message}` : message, "danger");
    if (table != null) {
      const prices = await syncProductsNow({ scope: "table", tableId: table }).catch(() => ({ ok: false as const }));
      if (!prices.ok) {
        say(COST_TABLE_SYNC_ERROR);
        return false;
      }
    }
    const result = await updateStoreCostTable(store.id, table).catch(() => ({ ok: false as const }));
    if (!result.ok) {
      say(SAVE_ERROR_MSG);
      return false;
    }
    setSavedTable(table);
    return true;
  }

  useRegisterSettingsDraft(store.id, { dirty, reset, save: persist });

  return (
    <FormField label="Tabela de custo" hint="Usada quando uma venda chega sem custo do produto.">
      <Select
        value={tablesLoading || table == null ? "" : String(table)}
        disabled={tablesLoading || noTables}
        onChange={(event) => setTable(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">{tablesLoading ? "Buscando tabelas no Millennium…" : "Nenhuma tabela"}</option>
        {!tablesLoading && table != null && !tables.some((item) => item.id === table) && (
          <option value={String(table)}>Tabela {table} · indisponível</option>
        )}
        {tables.map((item) => (
          <option key={item.id} value={String(item.id)}>
            {`Tabela ${item.code || item.id}`}
          </option>
        ))}
      </Select>
    </FormField>
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

function RentBlock({ store }: { store: Store }) {
  const { show } = useToast();
  const scope = useSettingsDraftScope();
  const form = useCostFields(store, RENT_FIELDS);
  const [seasonBaseline, setSeasonBaseline] = useState<RentSeason[]>(store.costs?.rentSeasons ?? []);
  const [seasons, setSeasons] = useState<SeasonDraft[]>(() => seasonDrafts(store.costs?.rentSeasons ?? []));
  const street = store.pointType === "STREET";
  const fields = street ? [RENT_MIN] : RENT_FIELDS;
  const pctSaved = parseNum(form.saved[RENT_PCT.key] ?? "");
  const removePct = street && pctSaved != null && pctSaved > 0;
  const seasonsDirty = !street && JSON.stringify(seasonsFromDraft(seasons)) !== JSON.stringify(seasonBaseline);
  const dirty = form.dirty || seasonsDirty;

  function reset() {
    form.reset();
    setSeasons(seasonDrafts(seasonBaseline));
  }

  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    const say = (message: string) => show(scope?.errorPrefix ? `${scope.errorPrefix}: ${message}` : message, "danger");
    const merged = form.merged();
    if (!merged) {
      say(INVALID_COSTS_MSG);
      return false;
    }
    const nextSeasons = street ? seasonBaseline : seasonsFromDraft(seasons);
    if (!nextSeasons) {
      say("Confira a sazonalidade. Informe o mês e um fator maior que zero, sem repetir o mesmo mês.");
      return false;
    }
    const costs = { ...(street ? RENT_PCT.set(merged, null) : merged), rentSeasons: nextSeasons };
    const result = await updateStoreCosts(store.id, costs).catch(() => ({ ok: false as const }));
    if (!result.ok) {
      say(SAVE_ERROR_MSG);
      return false;
    }
    form.markSaved(costs);
    setSeasonBaseline(nextSeasons);
    return true;
  }

  useRegisterSettingsDraft(store.id, { dirty, reset, save: persist });

  return (
    <div className="flex flex-col gap-4">
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
                    <FormField label="Repetição" required>
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
                      <FormField label="Mês" required>
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
                      <FormField label="Mês" required>
                        <Input
                          type="month"
                          value={row.yearMonth}
                          onChange={(event) => setSeasons((rows) => rows.map((item) => (item.key === row.key ? { ...item, yearMonth: event.target.value } : item)))}
                        />
                      </FormField>
                    )}
                    <FormField label="Fator" required hint="2 dobra o mínimo.">
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
    </div>
  );
}

export default BranchPage;
