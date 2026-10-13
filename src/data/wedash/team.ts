import { cpfDeBase } from "@/lib/cpf";
import { titleName } from "@/lib/format";

export type Role = "ADMIN_GLOBAL" | "OWNER" | "MANAGER" | "SELLER";
export type CollaboratorType = "SELLER" | "CENTRAL";
export type InactivityReason = "FERIAS" | "LICENCA" | "DESLIGAMENTO" | "OUTRO";

export interface Collaborator {
  id: string;
  storeId: string;
  millenniumFuncionario: number;
  codFuncionario: string;
  name: string;
  cargo: "SELLER";
  dataAdmissao: string;
  kind: CollaboratorType;
  grupoId: string | null;
  emailApp: string | null;
  celular: string | null;
  dataAniversario: string | null;
  excluirDeRanking: boolean;
  inativoNoErp: boolean;
  motivoInatividade: InactivityReason | null;
  dataInatividade: string | null;
  /** Peso relativo de venda usado pelo gerador de mocks. */
  pesoVenda: number;
  /** Tem vinculo (usa o app)? */
  usaApp: boolean;
}

export const collaborators: Collaborator[] = ([
  // Shopping Campo Grande
  { id: "c01", storeId: "f1", millenniumFuncionario: 343, codFuncionario: "0343", name: "Ana Paula Ferreira", cargo: "SELLER", dataAdmissao: "2024-03-14", kind: "SELLER", grupoId: "t-f1-manha", emailApp: "ana.ferreira@gmail.com", celular: "67991230001", dataAniversario: "1996-09-22", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 1.35, usaApp: true },
  { id: "c02", storeId: "f1", millenniumFuncionario: 351, codFuncionario: "0351", name: "Bruna Martins", cargo: "SELLER", dataAdmissao: "2024-05-02", kind: "SELLER", grupoId: "t-f1-tarde", emailApp: "bruna.martins@gmail.com", celular: "67991230002", dataAniversario: "1999-02-11", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 1.2, usaApp: true },
  { id: "c03", storeId: "f1", millenniumFuncionario: 366, codFuncionario: "0366", name: "Camila Souza", cargo: "SELLER", dataAdmissao: "2024-08-19", kind: "SELLER", grupoId: "t-f1-tarde", emailApp: "camila.souza@gmail.com", celular: "67991230003", dataAniversario: "2000-09-05", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 1.1, usaApp: true },
  { id: "c04", storeId: "f1", millenniumFuncionario: 372, codFuncionario: "0372", name: "Daniela Rocha", cargo: "SELLER", dataAdmissao: "2024-11-04", kind: "SELLER", grupoId: "t-f1-manha", emailApp: "dani.rocha@hotmail.com", celular: "67991230004", dataAniversario: "1994-12-30", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.95, usaApp: true },
  { id: "c05", storeId: "f1", millenniumFuncionario: 388, codFuncionario: "0388", name: "Eduarda Lima", cargo: "SELLER", dataAdmissao: "2025-02-10", kind: "SELLER", grupoId: "t-f1-tarde", emailApp: "duda.lima@gmail.com", celular: "67991230005", dataAniversario: "2001-06-18", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.9, usaApp: true },
  { id: "c06", storeId: "f1", millenniumFuncionario: 401, codFuncionario: "0401", name: "Fernanda Alves", cargo: "SELLER", dataAdmissao: "2025-04-22", kind: "SELLER", grupoId: "t-f1-manha", emailApp: null, celular: "67991230006", dataAniversario: "1998-03-09", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: "FERIAS", dataInatividade: "2026-09-10", pesoVenda: 0.85, usaApp: false },
  { id: "c07", storeId: "f1", millenniumFuncionario: 415, codFuncionario: "0415", name: "Gabriela Costa", cargo: "SELLER", dataAdmissao: "2025-07-01", kind: "SELLER", grupoId: "t-f1-tarde", emailApp: "gabi.costa@gmail.com", celular: "67991230007", dataAniversario: "1997-09-27", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.8, usaApp: true },
  { id: "c08", storeId: "f1", millenniumFuncionario: 430, codFuncionario: "0430", name: "Helena Ribeiro", cargo: "SELLER", dataAdmissao: "2026-01-12", kind: "SELLER", grupoId: "t-f1-manha", emailApp: "helena.rib@gmail.com", celular: null, dataAniversario: "2002-11-02", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.7, usaApp: true },
  { id: "c09", storeId: "f1", millenniumFuncionario: 300, codFuncionario: "0300", name: "CAIXA LOJA CG", cargo: "SELLER", dataAdmissao: "2024-03-14", kind: "CENTRAL", grupoId: null, emailApp: null, celular: null, dataAniversario: null, excluirDeRanking: true, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.45, usaApp: false },
  // Shopping Tres Lagoas
  { id: "c11", storeId: "f2", millenniumFuncionario: 1009, codFuncionario: "1009", name: "Isabela Nunes", cargo: "SELLER", dataAdmissao: "2025-06-02", kind: "SELLER", grupoId: "t-f2-manha", emailApp: "isa.nunes@gmail.com", celular: "67992340001", dataAniversario: "1995-04-14", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 1.3, usaApp: true },
  { id: "c12", storeId: "f2", millenniumFuncionario: 1012, codFuncionario: "1012", name: "Juliana Prado", cargo: "SELLER", dataAdmissao: "2025-06-02", kind: "SELLER", grupoId: "t-f2-tarde", emailApp: "ju.prado@gmail.com", celular: "67992340002", dataAniversario: "1993-09-12", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 1.15, usaApp: true },
  { id: "c13", storeId: "f2", millenniumFuncionario: 1018, codFuncionario: "1018", name: "Karina Mendes", cargo: "SELLER", dataAdmissao: "2025-08-11", kind: "SELLER", grupoId: "t-f2-manha", emailApp: "karina.m@gmail.com", celular: "67992340003", dataAniversario: "1999-07-30", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 1.0, usaApp: true },
  { id: "c14", storeId: "f2", millenniumFuncionario: 1023, codFuncionario: "1023", name: "Larissa Teixeira", cargo: "SELLER", dataAdmissao: "2025-10-06", kind: "SELLER", grupoId: "t-f2-tarde", emailApp: "lari.teixeira@gmail.com", celular: "67992340004", dataAniversario: "2000-01-25", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.95, usaApp: true },
  { id: "c15", storeId: "f2", millenniumFuncionario: 1031, codFuncionario: "1031", name: "Mariana Duarte", cargo: "SELLER", dataAdmissao: "2026-01-19", kind: "SELLER", grupoId: "t-f2-manha", emailApp: "mari.duarte@gmail.com", celular: "67992340005", dataAniversario: "1998-10-08", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.85, usaApp: true },
  { id: "c16", storeId: "f2", millenniumFuncionario: 1037, codFuncionario: "1037", name: "Natália Barros", cargo: "SELLER", dataAdmissao: "2026-03-02", kind: "SELLER", grupoId: "t-f2-tarde", emailApp: null, celular: "67992340006", dataAniversario: "2001-09-19", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.8, usaApp: false },
  { id: "c17", storeId: "f2", millenniumFuncionario: 1042, codFuncionario: "1042", name: "Patrícia Moraes", cargo: "SELLER", dataAdmissao: "2026-05-18", kind: "SELLER", grupoId: "t-f2-manha", emailApp: "paty.moraes@gmail.com", celular: "67992340007", dataAniversario: "1996-02-03", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.75, usaApp: true },
  { id: "c18", storeId: "f2", millenniumFuncionario: 1055, codFuncionario: "1055", name: "Rafaela Cardoso", cargo: "SELLER", dataAdmissao: "2026-09-08", kind: "SELLER", grupoId: "t-f2-tarde", emailApp: "rafa.cardoso@gmail.com", celular: "67992340008", dataAniversario: "2003-05-21", excluirDeRanking: false, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.6, usaApp: true },
  { id: "c19", storeId: "f2", millenniumFuncionario: 1000, codFuncionario: "1000", name: "CAIXA CENTRAL TL", cargo: "SELLER", dataAdmissao: "2025-06-02", kind: "CENTRAL", grupoId: null, emailApp: null, celular: null, dataAniversario: null, excluirDeRanking: true, inativoNoErp: false, motivoInatividade: null, dataInatividade: null, pesoVenda: 0.4, usaApp: false },
] as Collaborator[]).map((c) => ({ ...c, name: titleName(c.name) }));

export function collaboratorsOfStore(storeId: string): Collaborator[] {
  return collaborators.filter((c) => c.storeId === storeId);
}

export function collaboratorById(id: string): Collaborator | undefined {
  return collaborators.find((c) => c.id === id);
}

/** Vendedora elegivel para ranking, meta e comissao. */
export function eligibleSeller(c: Collaborator): boolean {
  return c.cargo === "SELLER" && c.kind === "SELLER" && !c.inativoNoErp && !c.excluirDeRanking;
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
    cpf: cpfDeBase("111444777"),
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
    cpf: cpfDeBase("529982247"),
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
    cpf: cpfDeBase("123456789"),
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
    cpf: cpfDeBase("987654321"),
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
