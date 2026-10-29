import { Button } from "@/components/ui";
import { brlCent } from "@/lib/format";
import type { GoalDraftForm } from "./goalDraft";

function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function modeLabel(mode: GoalDraftForm["tierMode"]): string {
  if (mode === "GENERAL") return "Geral";
  if (mode === "GROUP") return "Grupo";
  return "Individual";
}

export function GoalProposalCard({
  form,
  storeName,
  ready,
  missing,
  busy,
  onAuthorize,
  onDiscard,
}: {
  form: GoalDraftForm;
  storeName: string;
  ready: boolean;
  missing: string[];
  busy?: boolean;
  onAuthorize: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 rounded-[14px] border border-line bg-bg-2 p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Proposta de meta</p>
      <p className="mt-1 text-[14px] font-bold text-t0">{form.name || "Sem nome"}</p>
      <dl className="mt-2.5 grid grid-cols-1 gap-1.5 text-[12.5px] sm:grid-cols-2">
        <div>
          <dt className="text-t2">Filial</dt>
          <dd className="font-semibold text-t0">{storeName || "—"}</dd>
        </div>
        <div>
          <dt className="text-t2">Período</dt>
          <dd className="font-semibold text-t0">
            {fmtDay(form.startsOn)} – {fmtDay(form.endsOn)}
          </dd>
        </div>
        <div>
          <dt className="text-t2">Modo</dt>
          <dd className="font-semibold text-t0">{modeLabel(form.tierMode)}</dd>
        </div>
        <div>
          <dt className="text-t2">Meta da filial</dt>
          <dd className="font-semibold text-t0">{form.target != null ? brlCent(form.target) : "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-t2">Escada</dt>
          <dd className="font-semibold text-t0">
            {form.tiers.map((t) => `${t.minAttainmentPct}% · ${String(t.commissionPct).replace(".", ",")}%`).join(" → ")}
          </dd>
        </div>
      </dl>
      {!ready && missing.length > 0 ? (
        <p className="mt-2 text-[12px] text-warn">Falta: {missing.join(", ")}.</p>
      ) : (
        <p className="mt-2 text-[12px] text-t2">Grava como rascunho em Metas — voce revisa e publica la.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onAuthorize} disabled={!ready || busy}>
          {busy ? "Gravando…" : "Salvar rascunho"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDiscard} disabled={busy}>
          Descartar
        </Button>
      </div>
    </div>
  );
}
