import { useState, type ReactNode } from "react";
import { Card, useToast } from "@/components/ui";
import { EMPTY_STORE_COSTS, updateStoreCosts, type Store, type StoreCosts } from "@/data/wedash/stores";
import { CostCardTitle, FormActions, NumberField, SAVE_ERROR_MSG, numText, parseNum } from "./shared";

/** Campo de custo da loja: le e grava um pedaco de `store.custos`. */
export type CostField = {
  key: string;
  label: string;
  hint?: string;
  unit: "%" | "R$";
  get: (c: StoreCosts) => number | null;
  set: (c: StoreCosts, v: number | null) => StoreCosts;
};

export const pctField = (key: keyof StoreCosts, label: string, hint?: string): CostField => ({
  key,
  label,
  hint,
  unit: "%",
  get: (c) => c[key],
  set: (c, v) => ({ ...c, [key]: v }),
});

function toText(fields: CostField[], c: StoreCosts): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, numText(f.get(c), f.unit)]));
}

/** Estado de edicao dos campos de uma loja (texto, alterado, validacao e gravacao). */
export function useCostFields(loja: Store, fields: CostField[]) {
  const [saved, setSaved] = useState(() => toText(fields, loja.custos ?? EMPTY_STORE_COSTS));
  const [txt, setTxt] = useState(saved);
  const dirty = fields.some((f) => txt[f.key] !== saved[f.key]);

  /** null = algum campo invalido (% fora de 0 - 100 ou R$ negativo). */
  function merged(): StoreCosts | null {
    let c = loja.custos ?? EMPTY_STORE_COSTS;
    for (const f of fields) {
      const v = parseNum(txt[f.key] ?? "");
      if (Number.isNaN(v) || (v != null && (v < 0 || (f.unit === "%" && v > 100)))) return null;
      c = f.set(c, v);
    }
    return c;
  }

  return {
    txt,
    saved,
    dirty,
    setField: (key: string, v: string) => setTxt((p) => ({ ...p, [key]: v })),
    reset: () => setTxt(saved),
    merged,
    markSaved: (c: StoreCosts) => {
      const next = toText(fields, c);
      setSaved(next);
      setTxt(next);
    },
  };
}

export const INVALID_COSTS_MSG = "Confira os valores. Use percentuais entre 0 e 100 e não informe valores negativos.";

/** Bloco de campos com titulo e texto de apoio proprios (ex.: uma marca). */
export type CostFieldSection = { title: string; hint?: string; keys: string[] };

/** Card da loja com campos de custo e Resetar/Salvar proprios. */
export function CostFieldsCard({
  loja,
  fields,
  title,
  intro,
  sections,
  footer,
  onSaved,
}: {
  loja: Store;
  fields: CostField[];
  title: string;
  intro?: ReactNode;
  sections?: CostFieldSection[];
  footer?: ReactNode;
  onSaved: () => void;
}) {
  const { show } = useToast();
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

  const grid = (list: CostField[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {list.map((f) => (
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
  );

  return (
    <Card>
      <CostCardTitle title={title} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {intro && <p className="text-[12.5px] text-t2">{intro}</p>}
        {sections ? (
          sections.map((s) => (
            <div key={s.title} className="flex flex-col gap-3">
              <div>
                <p className="text-[14px] font-bold text-t0">{s.title}</p>
                {s.hint && <p className="mt-0.5 text-[12.5px] text-t2">{s.hint}</p>}
              </div>
              {grid(fields.filter((f) => s.keys.includes(f.key)))}
            </div>
          ))
        ) : (
          grid(fields)
        )}
        {footer}
        <FormActions dirty={form.dirty} saving={saving} onReset={form.reset} />
      </form>
    </Card>
  );
}
