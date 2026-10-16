import { sellerKeyFromName } from "@/data/wedash/salesAggregate";
import { millenniumCodeKey } from "@/data/wedash/stores";
import { getSupabase } from "@/lib/supabase";

/** Foto pública de quem tem conta WDash. Sem foto, a linha não entra. */
export type ProfilePhotoRef = {
  membershipId: string | null;
  storeId: string | null;
  employeeId: number | null;
  generatorId: number | null;
  nameKeys: string[];
  avatarUrl: string;
};

export type PersonPhotoQuery = {
  membershipId?: string | null;
  /** Código Millennium, `e:123` ou `n:NOME`. */
  employeeId?: number | string | null;
  generatorId?: number | null;
  storeId?: string | null;
  name?: string | null;
};

/** Fotos da empresa. Vazio se a função ainda não existe ou ninguém tem foto. */
export async function fetchProfilePhotos(tenantId: string): Promise<ProfilePhotoRef[]> {
  const client = getSupabase();
  if (!client) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("profile_photos", { p_tenant_id: tenantId });
  if (error) {
    console.warn("fetchProfilePhotos:", error.message);
    return [];
  }
  const out: ProfilePhotoRef[] = [];
  for (const r of (data ?? []) as {
    membership_id: string | null;
    store_id: string | null;
    employee_id: number | null;
    generator_id: number | null;
    name_keys: string[] | null;
    avatar_url: string | null;
  }[]) {
    const avatarUrl = r.avatar_url?.trim();
    if (!avatarUrl) continue;
    out.push({
      membershipId: r.membership_id,
      storeId: r.store_id,
      employeeId: r.employee_id == null ? null : Number(r.employee_id),
      generatorId: r.generator_id == null ? null : Number(r.generator_id),
      nameKeys: r.name_keys ?? [],
      avatarUrl,
    });
  }
  return out;
}

function employeeNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.startsWith("n:")) return null;
  const raw = value.startsWith("e:") ? value.slice(2) : value;
  const key = millenniumCodeKey(raw);
  if (!key) return null;
  const n = Number(key);
  return Number.isFinite(n) ? n : null;
}

function nameKeyOf(q: PersonPhotoQuery): string | null {
  if (typeof q.employeeId === "string" && q.employeeId.startsWith("n:")) {
    const key = q.employeeId.slice(2).trim();
    return key || null;
  }
  return sellerKeyFromName(q.name);
}

/** Código, gerador, depois nome. Sem correspondência = sem URL (a tela usa as iniciais). */
export function matchProfilePhoto(photos: ProfilePhotoRef[], q: PersonPhotoQuery): string | undefined {
  if (q.membershipId) {
    const hit = photos.find((p) => p.membershipId === q.membershipId);
    if (hit) return hit.avatarUrl;
  }
  const employeeId = employeeNumber(q.employeeId);
  if (employeeId != null) {
    const hit = photos.find((p) => p.employeeId === employeeId);
    if (hit) return hit.avatarUrl;
  }
  if (q.generatorId != null) {
    const hit = photos.find((p) => p.generatorId === q.generatorId);
    if (hit) return hit.avatarUrl;
  }
  const nameKey = nameKeyOf(q);
  if (!nameKey) return undefined;
  if (q.storeId) {
    const scoped = photos.find((p) => p.storeId === q.storeId && p.nameKeys.includes(nameKey));
    if (scoped) return scoped.avatarUrl;
  }
  return photos.find((p) => p.nameKeys.includes(nameKey))?.avatarUrl;
}
