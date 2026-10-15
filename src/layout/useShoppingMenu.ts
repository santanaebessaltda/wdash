import { shoppingMenu } from "@/data/wedash/shoppingReport";

/** A tela de Shopping avisou que o acesso foi salvo. */
export const SHOPPING_MENU_EVENT = "wedash:shopping";

/** Informe de vendas e a aba Administradora ficam no menu. */
export function useShoppingMenu(): { settings: boolean; report: boolean; ready: boolean } {
  return { ...shoppingMenu(), ready: true };
}
