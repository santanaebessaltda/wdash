/**
 * Chama o Edge jarvis-ai para intenções semânticas de meta (JSON schema).
 * Fallback: interpretador estrutural local (testes / offline / falha de rede).
 */
import { getSupabase } from "@/lib/supabase";
import type { GoalDraft } from "./goalDraft";
import {
  goalOpContextForModel,
  interpretGoalOpStructural,
  validateGoalOpIntent,
  type GoalOpIntent,
} from "./goalOpIntent";

export async function interpretGoalOpViaLlm(
  utterance: string,
  draft: GoalDraft | null,
  today: string,
): Promise<GoalOpIntent | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.functions.invoke("jarvis-ai", {
      body: {
        action: "interpret_goal_op",
        utterance,
        context: goalOpContextForModel(draft, today),
      },
    });
    if (error || !data || (data as { ok?: boolean }).ok === false) return null;
    const intent = validateGoalOpIntent((data as { intent?: unknown }).intent);
    return intent;
  } catch {
    return null;
  }
}

/** LLM se disponível; senão estrutural. Sempre retorna intent válido. */
export async function resolveGoalOpIntent(
  utterance: string,
  draft: GoalDraft | null,
  today: string,
  injected?: GoalOpIntent | null,
): Promise<GoalOpIntent> {
  if (injected) return injected;
  const fromLlm = await interpretGoalOpViaLlm(utterance, draft, today);
  if (fromLlm) return fromLlm;
  return interpretGoalOpStructural(utterance, {
    form: draft?.form ?? { tiers: [], target: null, startsOn: null, endsOn: null },
    copiedFrom: draft?.copiedFrom ?? null,
    copyStatus: draft?.copyStatus ?? null,
    today,
  });
}
