import { stores } from "@/data/wedash/stores";
import { demoTenant } from "@/data/wedash/tenant";
import type { Role, User } from "@/data/wedash/team";
import { titleName } from "@/lib/format";

/**
 * App session (membership + scope). With Supabase, hydrated after Auth;
 * in demo, built from the User fixture.
 */
export interface Session {
  membershipId: string;
  /** Identity contact name. */
  name: string;
  cpf: string;
  email: string;
  /** Foto de perfil (URL publica no Storage); null = iniciais. */
  avatarUrl: string | null;
  role: Role;
  isOwner: boolean;
  /** Resolved store ids in scope (owner = all). */
  stores: string[];
  collaboratorId: string | null;
  /** null = onboarding complete. */
  onboardingStep: number | null;
  /** true = must change password before onboarding/app. */
  temporaryPassword: boolean;
  tenantId: string;
  /** Company name (tenant.name)  -  identifies the account; the platform chrome always shows WDash. */
  companyName: string;
  /** Installed the PWA? Used for the persistent install notice. */
  appInstalled: boolean;
}

export function sessionFromUser(u: User): Session {
  return {
    membershipId: u.membershipId,
    name: titleName(u.name),
    cpf: u.cpf,
    email: u.email,
    avatarUrl: null,
    role: u.role,
    isOwner: u.isOwner,
    stores: u.stores.length ? u.stores : stores.map((f) => f.id),
    collaboratorId: u.collaboratorId,
    onboardingStep: u.onboardingStep,
    temporaryPassword: u.temporaryPassword ?? false,
    tenantId: demoTenant.id,
    companyName: demoTenant.name,
    appInstalled: false,
  };
}

export const roleLabel: Record<Role, string> = {
  ADMIN_GLOBAL: "Administrador",
  OWNER: "Gestor",
  MANAGER: "Gerente",
  SELLER: "Equipe de vendas",
};

/** Tipo de acesso exibido para a pessoa  -  quem criou a conta da empresa e o "Gestor principal". */
/** Lojas da sessao vem do banco sem ordem garantida: chave estavel para comparar. */
export function storesKey(stores: string[]): string {
  return [...stores].sort().join(",");
}

export function accessLabel(role: Role, isOwner?: boolean): string {
  return isOwner ? `${roleLabel[role]} principal` : roleLabel[role];
}
