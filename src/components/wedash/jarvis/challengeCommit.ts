import { challengeFormToInput, validateChallengeForm, type ChallengeForm } from "@/data/wedash/challengeForm";
import { saveChallenge } from "@/data/wedash/challengesRepo";
import { ensureChallengeName, missingChallengeLabels } from "./challengeDraft";

export type ChallengeCommitResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: string };

/** Grava o desafio publicado após autorização do Gestor. */
export async function commitChallenge(tenantId: string, form: ChallengeForm): Promise<ChallengeCommitResult> {
  const ready = ensureChallengeName(form);
  const errors = validateChallengeForm(ready);
  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: `Ainda falta ${missingChallengeLabels(errors).join(", ")} antes de gravar.` };
  }
  const input = { ...challengeFormToInput(ready), published: true };
  const res = await saveChallenge(tenantId, null, input);
  if (!res.ok) return { ok: false, reason: "Não consegui gravar o desafio. Tente de novo ou abra Performance > Desafios." };
  return { ok: true, id: res.id, name: input.name };
}
