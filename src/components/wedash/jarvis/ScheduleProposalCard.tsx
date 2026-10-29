import { Button } from "@/components/ui";
import type { SchedulePattern } from "@/data/wedash/scheduleGenerate";
import type { ScheduleDraftForm } from "./scheduleDraft";

function patternLabel(p: SchedulePattern): string {
  if (p === "6x1") return "6×1";
  if (p === "5x2") return "5×2";
  if (p === "4x3") return "4×3";
  return "12×36";
}

function monthLabel(iso: string | null): string {
  if (!iso) return "—";
  const names = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return `${names[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export function ScheduleProposalCard({
  form,
  storeName,
  ready,
  missing,
  busy,
  onAuthorize,
  onDiscard,
}: {
  form: ScheduleDraftForm;
  storeName: string;
  ready: boolean;
  missing: string[];
  busy?: boolean;
  onAuthorize: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 rounded-[14px] border border-line bg-bg-2 p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Proposta de escala</p>
      <p className="mt-1 text-[14px] font-bold text-t0">
        {patternLabel(form.pattern)} · {monthLabel(form.monthStart)}
      </p>
      <dl className="mt-2.5 grid grid-cols-1 gap-1.5 text-[12.5px] sm:grid-cols-2">
        <div>
          <dt className="text-t2">Filial</dt>
          <dd className="font-semibold text-t0">{storeName || "—"}</dd>
        </div>
        <div>
          <dt className="text-t2">Equipe</dt>
          <dd className="font-semibold text-t0">
            {form.people.length} pessoa{form.people.length === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-t2">Modelo</dt>
          <dd className="font-semibold text-t0">{patternLabel(form.pattern)}</dd>
        </div>
        <div>
          <dt className="text-t2">Dias manuais</dt>
          <dd className="font-semibold text-t0">{form.replaceManual ? "Substituir tudo" : "Manter"}</dd>
        </div>
        {form.holidayRules.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-t2">Feriados no mês</dt>
            <dd className="font-semibold text-t0">
              {form.holidayRules
                .slice(0, 4)
                .map((h) => `${h.name} (${h.date.slice(8, 10)}/${h.date.slice(5, 7)})`)
                .join("; ")}
              {form.holidayRules.length > 4 ? "…" : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {!ready && missing.length > 0 ? (
        <p className="mt-2 text-[12px] text-warn">Falta: {missing.join(", ")}.</p>
      ) : (
        <p className="mt-2 text-[12px] text-t2">Nada é gravado até você autorizar.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onAuthorize} disabled={!ready || busy}>
          {busy ? "Gerando…" : "Autorizar"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDiscard} disabled={busy}>
          Descartar
        </Button>
      </div>
    </div>
  );
}
