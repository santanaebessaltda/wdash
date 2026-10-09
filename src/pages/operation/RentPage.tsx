import { useState } from "react";
import { Card, Segmented, useToast } from "@/components/ui";
import { StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { updateStoreCosts, type PointType, type Store } from "@/data/wedash/stores";
import { INVALID_COSTS_MSG, useCostFields, type CostField } from "./costFields";
import { FormActions, NumberField, SAVE_ERROR_MSG, StoreCardHeader, StoreCardsPage, parseNum, useScopedStores } from "./shared";

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
  { value: "SHOPPING", label: "Shopping" },
  { value: "RUA", label: "Loja de rua" },
];

const INTRO =
  "Esses valores entram nos custos da operação e são considerados no cálculo do resultado operacional no Financeiro. Campos vazios são considerados 0.";

const POINT_HINT: Record<PointType, string[]> = {
  SHOPPING: [
    "No shopping, vale o maior valor entre o aluguel mensal e o aluguel percentual. Quando o percentual for maior, apenas o valor excedente é acrescentado aos custos da operação.",
    "Exemplo: aluguel mensal de R$ 10.000,00 e 10% sobre R$ 120.000,00 de faturamento = R$ 12.000,00 de aluguel, sendo R$ 2.000,00 de aluguel percentual excedente.",
    "No mês em andamento, a comparação considera o aluguel mensal proporcional aos dias já passados.",
  ],
  RUA: ["Na loja de rua, a WDash considera somente o aluguel mensal."],
};

/** Configuracoes > Aluguel  -  aluguel mensal e, em shopping, percentual do faturamento (conta so o que passar do aluguel). */
export function RentPage() {
  const { lojas, loading, refresh } = useScopedStores();
  return (
    <StoreCardsPage
      section="Custos"
      title="Aluguel"
      subtitle="Configure o aluguel mensal e, para lojas em shopping, o percentual sobre o faturamento."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} intro fields={2} />}
      lojas={lojas}
      oneStore
    >
      {(loja) => <RentCard loja={loja} onSaved={refresh} />}
    </StoreCardsPage>
  );
}

function RentCard({ loja, onSaved }: { loja: Store; onSaved: () => void }) {
  const { show } = useToast();
  const form = useCostFields(loja, RENT_FIELDS);
  const [savedPoint, setSavedPoint] = useState<PointType>(loja.pointType);
  const [point, setPoint] = useState<PointType>(savedPoint);
  const [saving, setSaving] = useState(false);
  const rua = point === "RUA";
  const fields = rua ? [RENT_MIN] : RENT_FIELDS;
  const pctSalvo = parseNum(form.saved[RENT_PCT.key] ?? "");
  const removePct = rua && pctSalvo != null && pctSalvo > 0;

  async function save() {
    const merged = form.merged();
    if (!merged) return show(INVALID_COSTS_MSG, "danger");
    const custos = rua ? RENT_PCT.set(merged, null) : merged;
    setSaving(true);
    const r = await updateStoreCosts(loja.id, custos, point);
    setSaving(false);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    form.markSaved(custos);
    setSavedPoint(point);
    onSaved();
    show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <StoreCardHeader loja={loja} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[12.5px] text-t2">{INTRO}</p>
        <div>
          <p className="mb-1.5 text-[12.5px] font-bold text-t0">Tipo de loja</p>
          <Segmented options={POINT_OPTIONS} value={point} onChange={(v) => v && setPoint(v)} />
          {removePct && (
            <p className="mt-1.5 text-[12px] font-semibold text-warn">O aluguel percentual será removido ao salvar as alterações.</p>
          )}
          <div className="mt-1.5 flex flex-col gap-1">
            {POINT_HINT[point].map((t) => (
              <p key={t} className="text-[11.5px] text-t2">
                {t}
              </p>
            ))}
          </div>
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
        <FormActions
          dirty={form.dirty || point !== savedPoint}
          saving={saving}
          onReset={() => {
            form.reset();
            setPoint(savedPoint);
          }}
        />
      </form>
    </Card>
  );
}

export default RentPage;
