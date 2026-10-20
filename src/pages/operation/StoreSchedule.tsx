import { Fragment, useEffect, useRef, useState } from "react";
import { Alert, Card, FormField, Select, Switch, useToast } from "@/components/ui";
import { updateStoreSchedule, type PointType, type Store } from "@/data/wedash/stores";
import {
  DOW_LABELS,
  STORE_TIMEZONES,
  canonicalStoreTimezone,
  parseWeekHours,
  presetWeekHours,
  weekHoursConfigured,
  type Dow,
  type StoreWeekHours,
} from "@/data/wedash/storeHours";
import { cn } from "@/lib/cn";
import { BlockTitle, FormActions, SAVE_ERROR_MSG, TimeSelect, useRegisterSettingsDraft, useSettingsDraftScope } from "./shared";

const DOWS: Dow[] = [0, 1, 2, 3, 4, 5, 6];

function initialHours(store: Store): StoreWeekHours {
  const saved = parseWeekHours(store.hours);
  return weekHoursConfigured(saved) ? saved : presetWeekHours(store.pointType);
}

/** Funcionamento da loja: fuso horario + horario por dia (Resetar / Salvar alteracoes). */
export function StoreScheduleForm({
  store,
  canEdit,
  onSaved,
  pointType,
  presetStamp = 0,
}: {
  store: Store;
  canEdit: boolean;
  onSaved: () => void;
  /** Tipo escolhido na Filial. Só sugere o horário; quem grava o tipo é o card Filial. */
  pointType?: PointType;
  /** Incrementa quando a pessoa troca o tipo, para preencher o padrão. */
  presetStamp?: number;
}) {
  const { show } = useToast();
  const scope = useSettingsDraftScope();
  const [saved, setSaved] = useState(() => ({
    timezone: canonicalStoreTimezone(store.timezone),
    hours: parseWeekHours(store.hours),
  }));
  const [timezone, setTimezone] = useState(saved.timezone);
  const [hours, setHours] = useState<StoreWeekHours>(() => initialHours(store));
  const [saving, setSaving] = useState(false);
  const type = pointType ?? store.pointType;
  const seenPreset = useRef(presetStamp);
  useEffect(() => {
    if (presetStamp === seenPreset.current) return;
    seenPreset.current = presetStamp;
    setHours(presetWeekHours(type));
  }, [presetStamp, type]);
  const dirty = timezone !== saved.timezone || JSON.stringify(hours) !== JSON.stringify(saved.hours);
  const preset = presetWeekHours(type);

  async function persist(): Promise<boolean> {
    const say = (message: string) => show(scope?.errorPrefix ? `${scope.errorPrefix}: ${message}` : message, "danger");
    const invalid = DOWS.find((d) => {
      const day = hours[d];
      return day != null && day.open >= day.close;
    });
    if (invalid != null) {
      say("O horário de abertura deve ser anterior ao horário de fechamento.");
      return false;
    }
    setSaving(true);
    const r = await updateStoreSchedule({ storeId: store.id, timezone, hours }).catch(() => ({ ok: false as const }));
    setSaving(false);
    if (!r.ok) {
      say(SAVE_ERROR_MSG);
      return false;
    }
    setSaved({ timezone, hours });
    return true;
  }

  async function save() {
    const ok = await persist();
    if (!ok) return;
    onSaved();
    show("Alterações salvas.", "success");
  }

  useRegisterSettingsDraft(store.id, { dirty, reset, save: persist });

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
    setHours(presetWeekHours(type));
  }

  const copySource = DOWS.find((d) => hours[d] != null);

  const fields = (
    <div className="flex flex-col gap-4">
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

      <FormField label="Horários da semana">
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
                    Copiar horário
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
            Usar horário padrão
          </button>
        )}
      </FormField>
      {canEdit && !scope && <FormActions dirty={dirty} saving={saving} onReset={reset} />}
    </div>
  );

  if (scope) return fields;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields}
    </form>
  );
}

export const HOURS_TIP = "O horário é usado nas atualizações automáticas, nos gráficos por hora e na distribuição da meta do dia.";

/** Fuso + horário. A Configurações e o detalhe da filial usam o mesmo bloco. */
export function StoreHoursCard({
  store,
  canEdit,
  onSaved,
  pointType,
  presetStamp,
  storeLabel,
  plain = false,
}: {
  store: Store;
  canEdit: boolean;
  onSaved: () => void;
  pointType?: PointType;
  presetStamp?: number;
  /** Nome da filial, só quando o seletor tem mais de uma. */
  storeLabel?: string;
  /** Sem o card: a página de Configurações agrupa as seções num card só. */
  plain?: boolean;
}) {
  const body = (
    <>
      <BlockTitle title="Funcionamento" tip={HOURS_TIP} store={storeLabel} />
      {!weekHoursConfigured(store.hours) && (
        <Alert variant="warning" className="mb-4" title="Horário não configurado">
          As vendas serão atualizadas apenas pelo botão Atualizar enquanto não houver horário definido.
        </Alert>
      )}
      <StoreScheduleForm store={store} canEdit={canEdit} onSaved={onSaved} pointType={pointType} presetStamp={presetStamp} />
    </>
  );
  return plain ? body : <Card>{body}</Card>;
}
