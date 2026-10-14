import { shoppingMenu } from "@/data/wedash/shoppingReport";

/** A tela de Shopping avisou que o acesso foi salvo. */
export const SHOPPING_MENU_EVENT = "wedash:shopping";

/** Informe de vendas fica no menu. A administradora é escolhida em Filial. */
export function useShoppingMenu(): { settings: boolean; report: boolean; ready: boolean } {
  return { ...shoppingMenu(), ready: true };
}
