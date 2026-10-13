import { useState } from "react";
import { Card, Segmented, useToast } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { updateStoreCosts, type PointType, type Store } from "@/data/wedash/stores";
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
  { value: "RUA", label: "Loja de rua" },
];

const RENT_HINT: Record<PointType, string[]> = {
  SHOPPING: [
    "A WDash considera o maior valor entre o aluguel mensal e o aluguel percentual. Quando o percentual for maior, somente o valor excedente é acrescentado ao aluguel mensal.",
    "Exemplo: com aluguel mensal de R$ 10.000,00 e aluguel percentual de 10% sobre R$ 120.000,00 de faturamento, o aluguel considerado será de R$ 12.000,00. Os R$ 2.000,00 adicionais correspondem ao aluguel percentual excedente.",
    "No mês em andamento, a comparação considera o aluguel mensal proporcional aos dias já passados.",
  ],
  RUA: ["Na loja de rua, a WDash considera somente o aluguel mensal."],
};

const FRANCHISE_INTRO =
  "Esses percentuais entram nos custos da operação e são considerados no cálculo do resultado operacional no Financeiro. Campos vazios são considerados 0%.";

function franchiseFields(store: Store): CostField[] {
  return [
    pctField("royaltiesWepinkPct", "Royalties WEPINK"),
    pctField("marketingWepinkPct", "Taxa de marketing WEPINK"),
    ...(store.temWpink
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
    ...(store.temWpink
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

/** Configurações > Filial. Tipo, funcionamento, franquia e aluguel da unidade. */
export function BranchPage() {
  const { storeRows, loading, refresh } = useScopedStores();
  return (
    <StoreCardsPage
      section="Configurações"
      title="Filial"
      subtitle="Configure o tipo, o funcionamento, a franquia e o aluguel de cada filial."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} title schedule sections={2} />}
      storeRows={storeRows}
      oneStore
    >
      {(store) => <BranchCards store={store} onSaved={refresh} />}
    </StoreCardsPage>
  );
}

function BranchCards({ store, onSaved }: { store: Store; onSaved: () => void }) {
  const [point, setPoint] = useState<PointType>(store.pointType);
  const [presetStamp, setPresetStamp] = useState(0);

  function escolher(next: PointType) {
    if (next === point) return;
    setPoint(next);
    setPresetStamp((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CostCardTitle title="Filial" />
        <p className="mb-3 text-[12.5px] text-t2">O tipo da filial define o horário sugerido e as opções de aluguel.</p>
        <p className="mb-1.5 text-[12.5px] font-bold text-t0">Tipo de filial</p>
        <Segmented options={POINT_OPTIONS} value={point} onChange={(v) => v && escolher(v)} />
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
    </div>
  );
}

function RentCard({ store, point, onSaved }: { store: Store; point: PointType; onSaved: () => void }) {
  const { show } = useToast();
  const form = useCostFields(store, RENT_FIELDS);
  const [saving, setSaving] = useState(false);
  const rua = point === "RUA";
  const mensal = rua ? { ...RENT_MIN, label: "Aluguel mensal" } : RENT_MIN;
  const fields = rua ? [mensal] : RENT_FIELDS;
  const pctSalvo = parseNum(form.saved[RENT_PCT.key] ?? "");
  const removePct = rua && pctSalvo != null && pctSalvo > 0;
  const typeDirty = point !== store.pointType;

  async function save() {
    const merged = form.merged();
    if (!merged) return show(INVALID_COSTS_MSG, "danger");
    const custos = rua ? RENT_PCT.set(merged, null) : merged;
    setSaving(true);
    const r = await updateStoreCosts(store.id, custos, point);
    setSaving(false);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    form.markSaved(custos);
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
        <FormActions dirty={form.dirty || typeDirty} saving={saving} onReset={form.reset} />
      </form>
    </Card>
  );
}

export default BranchPage;
