import { saveGoal } from "@/data/wedash/goalsRepo";
import { ensureGoalName, goalDraftReady, missingGoalLabels, validateGoalDraft, type GoalDraftForm } from "./goalDraft";

export type GoalCommitResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: string };

/** Grava a meta publicada após autorização do Gestor. */
export async function commitGoal(tenantId: string, form: GoalDraftForm): Promise<GoalCommitResult> {
  const ready = ensureGoalName(form);
  const errors = validateGoalDraft(ready);
  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: `Ainda falta ${missingGoalLabels(errors).join(", ")} antes de gravar.` };
  }
  const tiers = ready.managerOn
    ? ready.tiers.map((t) => ({
        ...t,
        managerPct: t.managerPct ?? t.commissionPct,
        managerBonus: t.managerBonus ?? 0,
      }))
    : ready.tiers.map(({ name, minAttainmentPct, commissionPct, bonus }) => ({
        name,
        minAttainmentPct,
        commissionPct,
        bonus,
      }));

  const res = await saveGoal(tenantId, null, {
    storeId: ready.storeId,
    name: ready.name.trim(),
    startsOn: ready.startsOn!,
    endsOn: ready.endsOn!,
    target: ready.target!,
    tierMode: ready.tierMode,
    spreadUnidentified: ready.spreadUnidentified,
    tiers,
    groups: [],
    published: true,
  });
  if (!res.ok) {
    if (res.reason === "overlap") {
      return { ok: false, reason: "Já existe uma meta desta filial nesse período. Ajuste as datas ou edite a meta existente." };
    }
    return { ok: false, reason: "Não consegui gravar a meta. Tente de novo ou abra Performance > Metas." };
  }
  return { ok: true, id: res.id, name: ready.name.trim() };
}

export { goalDraftReady };
