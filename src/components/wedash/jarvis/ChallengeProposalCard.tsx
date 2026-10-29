import { Button } from "@/components/ui";
import type { ChallengeForm } from "@/data/wedash/challengeForm";
import { CHALLENGE_METRIC_LABEL, CHALLENGE_MODE_LABEL, CHALLENGE_SCOPE_LABEL } from "@/data/wedash/challengeView";
import { dateToIso } from "@/lib/format";

function fmtDay(d: Date | null): string {
  if (!d) return "—";
  const iso = dateToIso(d);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function prizeLabel(form: ChallengeForm): string {
  const p = form.prizes[0];
  if (!p) return "—";
  if (p.kind === "MONEY") return p.amount ? `R$ ${p.amount}` : "—";
  return p.label || "—";
}

export function ChallengeProposalCard({
  form,
  storeName,
  ready,
  missing,
  busy,
  onAuthorize,
  onDiscard,
}: {
  form: ChallengeForm;
  storeName: string;
  ready: boolean;
  missing: string[];
  busy?: boolean;
  onAuthorize: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 rounded-[14px] border border-line bg-bg-2 p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Proposta de desafio</p>
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
          <dd className="font-semibold text-t0">{CHALLENGE_MODE_LABEL[form.mode]}</dd>
        </div>
        <div>
          <dt className="text-t2">Métrica</dt>
          <dd className="font-semibold text-t0">{CHALLENGE_METRIC_LABEL[form.metric]}</dd>
        </div>
        <div>
          <dt className="text-t2">O que conta</dt>
          <dd className="font-semibold text-t0">{CHALLENGE_SCOPE_LABEL[form.scope]}</dd>
        </div>
        <div>
          <dt className="text-t2">Prêmio</dt>
          <dd className="font-semibold text-t0">{prizeLabel(form)}</dd>
        </div>
        {form.products.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-t2">Produtos</dt>
            <dd className="font-semibold text-t0">
              {form.products
                .slice(0, 5)
                .map((p) => p.name)
                .join(", ")}
              {form.products.length > 5 ? ` (+${form.products.length - 5})` : ""}
            </dd>
          </div>
        ) : null}
        {form.target ? (
          <div>
            <dt className="text-t2">Alvo</dt>
            <dd className="font-semibold text-t0">{form.target}</dd>
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
          {busy ? "Gravando…" : "Autorizar"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDiscard} disabled={busy}>
          Descartar
        </Button>
      </div>
    </div>
  );
}
