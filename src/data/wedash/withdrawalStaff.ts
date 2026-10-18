import { type WithdrawalPerson } from "@/data/wedash/employeeWithdrawal";
import { titleName } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";

/** Gestores e gerentes ativos da tela Usuários. Convite sem nome fica de fora. */
export async function fetchWithdrawalStaff(tenantId: string): Promise<WithdrawalPerson[]> {
  const client = getSupabase();
  if (!client) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("withdrawal_staff", { p_tenant_id: tenantId });
  if (error) {
    console.warn("fetchWithdrawalStaff:", error.message);
    return [];
  }
  const people: WithdrawalPerson[] = [];
  for (const row of (data ?? []) as { id?: string | null; name?: string | null }[]) {
    const id = row.id?.trim() ?? "";
    const name = titleName(row.name);
    if (!id || !name) continue;
    people.push({ id, name, active: true });
  }
  return people;
}
