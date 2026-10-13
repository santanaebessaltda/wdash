import { cpfOfBase } from "@/lib/cpf";
import { titleName } from "@/lib/format";

export type Role = "ADMIN_GLOBAL" | "OWNER" | "MANAGER" | "SELLER";
export type CollaboratorType = "SELLER" | "CENTRAL";
export type InactivityReason = "FERIAS" | "LICENCA" | "DESLIGAMENTO" | "OUTRO";

export interface Collaborator {
  id: string;
  storeId: string;
  millenniumEmployee: number;
  employeeCode: string;
  name: string;
  role: "SELLER";
  hiredAt: string;
  kind: CollaboratorType;
  groupId: string | null;
  emailApp: string | null;
  celular: string | null;
  birthDate: string | null;
  excludeFromRanking: boolean;
  inactiveInErp: boolean;
  inactiveReason: InactivityReason | null;
  inactiveAt: string | null;
  /** Peso relativo de venda usado pelo gerador de mocks. */
  saleWeight: number;
  /** Tem vinculo (usa o app)? */
  usesApp: boolean;
}

export const collaborators: Collaborator[] = ([
  // Shopping Campo Grande
  { id: "c01", storeId: "f1", millenniumEmployee: 343, employeeCode: "0343", name: "Ana Paula Ferreira", role: "SELLER", hiredAt: "2024-03-14", kind: "SELLER", groupId: "t-f1-manha", emailApp: "ana.ferreira@gmail.com", celular: "67991230001", birthDate: "1996-09-22", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 1.35, usesApp: true },
  { id: "c02", storeId: "f1", millenniumEmployee: 351, employeeCode: "0351", name: "Bruna Martins", role: "SELLER", hiredAt: "2024-05-02", kind: "SELLER", groupId: "t-f1-tarde", emailApp: "bruna.martins@gmail.com", celular: "67991230002", birthDate: "1999-02-11", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 1.2, usesApp: true },
  { id: "c03", storeId: "f1", millenniumEmployee: 366, employeeCode: "0366", name: "Camila Souza", role: "SELLER", hiredAt: "2024-08-19", kind: "SELLER", groupId: "t-f1-tarde", emailApp: "camila.souza@gmail.com", celular: "67991230003", birthDate: "2000-09-05", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 1.1, usesApp: true },
  { id: "c04", storeId: "f1", millenniumEmployee: 372, employeeCode: "0372", name: "Daniela Rocha", role: "SELLER", hiredAt: "2024-11-04", kind: "SELLER", groupId: "t-f1-manha", emailApp: "dani.rocha@hotmail.com", celular: "67991230004", birthDate: "1994-12-30", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.95, usesApp: true },
  { id: "c05", storeId: "f1", millenniumEmployee: 388, employeeCode: "0388", name: "Eduarda Lima", role: "SELLER", hiredAt: "2025-02-10", kind: "SELLER", groupId: "t-f1-tarde", emailApp: "duda.lima@gmail.com", celular: "67991230005", birthDate: "2001-06-18", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.9, usesApp: true },
  { id: "c06", storeId: "f1", millenniumEmployee: 401, employeeCode: "0401", name: "Fernanda Alves", role: "SELLER", hiredAt: "2025-04-22", kind: "SELLER", groupId: "t-f1-manha", emailApp: null, celular: "67991230006", birthDate: "1998-03-09", excludeFromRanking: false, inactiveInErp: false, inactiveReason: "FERIAS", inactiveAt: "2026-09-10", saleWeight: 0.85, usesApp: false },
  { id: "c07", storeId: "f1", millenniumEmployee: 415, employeeCode: "0415", name: "Gabriela Costa", role: "SELLER", hiredAt: "2025-07-01", kind: "SELLER", groupId: "t-f1-tarde", emailApp: "gabi.costa@gmail.com", celular: "67991230007", birthDate: "1997-09-27", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.8, usesApp: true },
  { id: "c08", storeId: "f1", millenniumEmployee: 430, employeeCode: "0430", name: "Helena Ribeiro", role: "SELLER", hiredAt: "2026-01-12", kind: "SELLER", groupId: "t-f1-manha", emailApp: "helena.rib@gmail.com", celular: null, birthDate: "2002-11-02", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.7, usesApp: true },
  { id: "c09", storeId: "f1", millenniumEmployee: 300, employeeCode: "0300", name: "CAIXA LOJA CG", role: "SELLER", hiredAt: "2024-03-14", kind: "CENTRAL", groupId: null, emailApp: null, celular: null, birthDate: null, excludeFromRanking: true, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.45, usesApp: false },
  // Shopping Tres Lagoas
  { id: "c11", storeId: "f2", millenniumEmployee: 1009, employeeCode: "1009", name: "Isabela Nunes", role: "SELLER", hiredAt: "2025-06-02", kind: "SELLER", groupId: "t-f2-manha", emailApp: "isa.nunes@gmail.com", celular: "67992340001", birthDate: "1995-04-14", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 1.3, usesApp: true },
  { id: "c12", storeId: "f2", millenniumEmployee: 1012, employeeCode: "1012", name: "Juliana Prado", role: "SELLER", hiredAt: "2025-06-02", kind: "SELLER", groupId: "t-f2-tarde", emailApp: "ju.prado@gmail.com", celular: "67992340002", birthDate: "1993-09-12", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 1.15, usesApp: true },
  { id: "c13", storeId: "f2", millenniumEmployee: 1018, employeeCode: "1018", name: "Karina Mendes", role: "SELLER", hiredAt: "2025-08-11", kind: "SELLER", groupId: "t-f2-manha", emailApp: "karina.m@gmail.com", celular: "67992340003", birthDate: "1999-07-30", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 1.0, usesApp: true },
  { id: "c14", storeId: "f2", millenniumEmployee: 1023, employeeCode: "1023", name: "Larissa Teixeira", role: "SELLER", hiredAt: "2025-10-06", kind: "SELLER", groupId: "t-f2-tarde", emailApp: "lari.teixeira@gmail.com", celular: "67992340004", birthDate: "2000-01-25", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.95, usesApp: true },
  { id: "c15", storeId: "f2", millenniumEmployee: 1031, employeeCode: "1031", name: "Mariana Duarte", role: "SELLER", hiredAt: "2026-01-19", kind: "SELLER", groupId: "t-f2-manha", emailApp: "mari.duarte@gmail.com", celular: "67992340005", birthDate: "1998-10-08", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.85, usesApp: true },
  { id: "c16", storeId: "f2", millenniumEmployee: 1037, employeeCode: "1037", name: "Natália Barros", role: "SELLER", hiredAt: "2026-03-02", kind: "SELLER", groupId: "t-f2-tarde", emailApp: null, celular: "67992340006", birthDate: "2001-09-19", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.8, usesApp: false },
  { id: "c17", storeId: "f2", millenniumEmployee: 1042, employeeCode: "1042", name: "Patrícia Moraes", role: "SELLER", hiredAt: "2026-05-18", kind: "SELLER", groupId: "t-f2-manha", emailApp: "paty.moraes@gmail.com", celular: "67992340007", birthDate: "1996-02-03", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.75, usesApp: true },
  { id: "c18", storeId: "f2", millenniumEmployee: 1055, employeeCode: "1055", name: "Rafaela Cardoso", role: "SELLER", hiredAt: "2026-09-08", kind: "SELLER", groupId: "t-f2-tarde", emailApp: "rafa.cardoso@gmail.com", celular: "67992340008", birthDate: "2003-05-21", excludeFromRanking: false, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.6, usesApp: true },
  { id: "c19", storeId: "f2", millenniumEmployee: 1000, employeeCode: "1000", name: "CAIXA CENTRAL TL", role: "SELLER", hiredAt: "2025-06-02", kind: "CENTRAL", groupId: null, emailApp: null, celular: null, birthDate: null, excludeFromRanking: true, inactiveInErp: false, inactiveReason: null, inactiveAt: null, saleWeight: 0.4, usesApp: false },
] as Collaborator[]).map((c) => ({ ...c, name: titleName(c.name) }));

export function collaboratorsOfStore(storeId: string): Collaborator[] {
  return collaborators.filter((c) => c.storeId === storeId);
}

export function collaboratorById(id: string): Collaborator | undefined {
  return collaborators.find((c) => c.id === id);
}

/** Vendedora elegivel para ranking, meta e comissao. */
export function eligibleSeller(c: Collaborator): boolean {
  return c.role === "SELLER" && c.kind === "SELLER" && !c.inactiveInErp && !c.excludeFromRanking;
}

/** Identidade + vinculo mockados. O CPF e o login. */
export interface User {
  membershipId: string;
  identityId: string;
  name: string;
  cpf: string;
  email: string;
  role: Role;
  isOwner: boolean;
  /** Filiais do escopo. Vazio para gestor = todas. */
  stores: string[];
  collaboratorId: string | null;
  /** null = onboarding concluido. */
  onboardingStep: number | null;
  /** true = login com senha temporaria; obrigar troca antes do resto. */
  temporaryPassword?: boolean;
}

export const users: User[] = [
  {
    membershipId: "v-renata",
    identityId: "i-renata",
    name: "Renata Albuquerque",
    cpf: cpfOfBase("111444777"),
    email: "renata@wedash.app",
    role: "OWNER",
    isOwner: true,
    stores: [],
    collaboratorId: null,
    onboardingStep: null,
  },
  {
    membershipId: "v-marcos",
    identityId: "i-marcos",
    name: "Marcos Vieira",
    cpf: cpfOfBase("529982247"),
    email: "marcos.vieira@gmail.com",
    role: "MANAGER",
    isOwner: false,
    stores: ["f2"],
    collaboratorId: null,
    onboardingStep: null,
  },
  {
    membershipId: "v-camila",
    identityId: "i-camila",
    name: "Camila Souza",
    cpf: cpfOfBase("123456789"),
    email: "camila.souza@gmail.com",
    role: "SELLER",
    isOwner: false,
    stores: ["f1"],
    collaboratorId: "c03",
    onboardingStep: null,
  },
  {
    membershipId: "v-novo",
    identityId: "i-novo",
    name: "Paulo Henrique Sá",
    cpf: cpfOfBase("987654321"),
    email: "paulo.sa@gmail.com",
    role: "OWNER",
    isOwner: true,
    stores: [],
    collaboratorId: null,
    onboardingStep: 1,
    temporaryPassword: true,
  },
];

export function userByCpf(cpfDigitos: string): User | undefined {
  return users.find((u) => u.cpf === cpfDigitos);
}

export function userByEmail(email: string): User | undefined {
  const e = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === e);
}
