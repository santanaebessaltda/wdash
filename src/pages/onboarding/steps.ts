import type { WizardStep } from "@/components/ui/WizardSteps";

/**
 * Etapas do primeiro acesso do Gestor. 1 = Crie seu acesso (/create-access: nome, sobrenome e senha);
 * 2 = Integracao ERP (/onboarding  -  `onboarding_step` = 2; 1 e 3 sao legado e caem no ERP).
 * Lojas nao tem etapa: todas as do usuario Millennium entram ao conectar.
 */
export const ONBOARDING_STEPS: WizardStep[] = [
  { num: 1, label: "Crie seu acesso" },
  { num: 2, label: "Conecte o Millennium" },
];
