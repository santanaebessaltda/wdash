import { Fragment, useState } from "react";
import { FormField, Select, Switch, useToast } from "@/components/ui";
import { updateStoreSchedule, type Store } from "@/data/wedash/stores";
import {
  DOW_LABELS,
  PRESET_HOURS_HINT,
  STORE_TIMEZONES,
  canonicalStoreTimezone,
  parseWeekHours,
  presetWeekHours,
  weekHoursConfigured,
  type Dow,
  type StoreWeekHours,
} from "@/data/wedash/storeHours";
import { cn } from "@/lib/cn";
import { FormActions, SAVE_ERROR_MSG, TimeSelect } from "./shared";

const DOWS: Dow[] = [0, 1, 2, 3, 4, 5, 6];

function initialHours(store: Store): StoreWeekHours {
  const saved = parseWeekHours(store.horas);
  return weekHoursConfigured(saved) ? saved : presetWeekHours(store.pointType);
}

/** Funcionamento da loja: fuso horario + horario por dia (Resetar / Salvar alteracoes). */
export function StoreScheduleForm({ store, canEdit, onSaved }: { store: Store; canEdit: boolean; onSaved: () => void }) {
  const { show } = useToast();
  const [saved, setSaved] = useState(() => ({
    timezone: canonicalStoreTimezone(store.fuso),
    hours: parseWeekHours(store.horas),
  }));
  const [timezone, setTimezone] = useState(saved.timezone);
  const [hours, setHours] = useState<StoreWeekHours>(() => initialHours(store));
  const [saving, setSaving] = useState(false);
  const dirty = timezone !== saved.timezone || JSON.stringify(hours) !== JSON.stringify(saved.hours);
  const showingPreset = !weekHoursConfigured(saved.hours);
  const preset = presetWeekHours(store.pointType);

  async function save() {
    const invalid = DOWS.find((d) => {
      const day = hours[d];
      return day != null && day.open >= day.close;
    });
    if (invalid != null) {
      show(`${DOW_LABELS[invalid]}: o horário de abertura deve ser anterior ao horário de fechamento.`, "danger");
      return;
    }
    setSaving(true);
    const r = await updateStoreSchedule({ storeId: store.id, timezone, hours }).catch(() => ({ ok: false as const }));
    setSaving(false);
    if (!r.ok) {
      show(SAVE_ERROR_MSG, "danger");
      return;
    }
    setSaved({ timezone, hours });
    onSaved();
    show("Alterações salvas.", "success");
  }

  function reset() {
    setTimezone(saved.timezone);
    setHours(weekHoursConfigured(saved.hours) ? saved.hours : presetWeekHours(store.pointType));
  }

  function toggleDow(d: Dow) {
    const next = { ...hours };
    if (next[d]) {
      next[d] = null;
    } else {
      const fromPreset = preset[d];
      const template = fromPreset ?? DOWS.map((x) => hours[x]).find((x) => x != null) ?? { open: "09:00", close: "21:00" };
      next[d] = { ...template };
    }
    setHours(next);
  }

  function setDayTime(d: Dow, field: "open" | "close", value: string) {
    const cur = hours[d];
    if (!cur) return;
    setHours({ ...hours, [d]: { ...cur, [field]: value } });
  }

  function copyToAll(from: Dow) {
    const src = hours[from];
    if (!src) return;
    const next = { ...hours };
    for (const d of DOWS) if (next[d]) next[d] = { ...src };
    setHours(next);
  }

  function applyPreset() {
    setHours(presetWeekHours(store.pointType));
  }

  const copySource = DOWS.find((d) => hours[d] != null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormField
        label="Fuso horário"
        hint={(() => {
          const tz = STORE_TIMEZONES.find((t) => t.value === timezone);
          return tz ? `Vale para: ${tz.states}` : undefined;
        })()}
      >
        <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canEdit}>
          {!STORE_TIMEZONES.some((t) => t.value === timezone) && <option value={timezone}>{timezone}</option>}
          {STORE_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Dias e horários" hint={showingPreset ? PRESET_HOURS_HINT[store.pointType] : undefined}>
        <div>
          {DOWS.map((d) => {
            const day = hours[d];
            return (
              <Fragment key={d}>
                <div className="flex min-h-[44px] items-center gap-2 py-1 sm:gap-3">
                  <span className="w-9 shrink-0 text-[13px] font-semibold text-t0 sm:w-28">
                    <span className="sm:hidden">{DOW_LABELS[d].slice(0, 3)}</span>
                    <span className="hidden sm:inline">{DOW_LABELS[d]}</span>
                  </span>
                  <div className={cn("shrink-0 sm:w-[92px]", !canEdit && "pointer-events-none opacity-60")}>
                    <Switch
                      checked={day != null}
                      onChange={() => toggleDow(d)}
                      label={<span className={cn("text-t2", day && "hidden sm:inline")}>{day ? "Aberto" : "Fechado"}</span>}
                    />
                  </div>
                  {day && (
                    <>
                      <TimeSelect
                        value={day.open}
                        disabled={!canEdit}
                        onChange={(v) => setDayTime(d, "open", v)}
                        aria-label={`Abertura de ${DOW_LABELS[d].toLowerCase()}`}
                      />
                      <span className="text-t2">–</span>
                      <TimeSelect
                        value={day.close}
                        disabled={!canEdit}
                        onChange={(v) => setDayTime(d, "close", v)}
                        aria-label={`Fechamento de ${DOW_LABELS[d].toLowerCase()}`}
                      />
                    </>
                  )}
                </div>
                {canEdit && d === copySource && (
                  <button
                    type="button"
                    onClick={() => copyToAll(d)}
                    className="mb-1 pl-[96px] text-left text-[12.5px] font-semibold text-acc hover:underline sm:pl-[228px]"
                  >
                    Copiar horário para os outros dias abertos
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={applyPreset}
            className="mt-2 text-left text-[12.5px] font-semibold text-acc hover:underline"
          >
            {store.pointType === "RUA" ? "Preencher com o padrão de loja de rua" : "Preencher com o padrão de quiosque"}
          </button>
        )}
      </FormField>
      {canEdit && <FormActions dirty={dirty} saving={saving} onReset={reset} />}
    </form>
  );
}
