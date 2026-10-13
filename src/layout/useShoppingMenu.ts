import { useEffect, useState } from "react";
import { storesForSession } from "@/data/wedash/stores";
import { fetchShoppingAccount } from "@/data/wedash/shoppingRepo";
import { shoppingMenu, type ShoppingAdministrator } from "@/data/wedash/shoppingReport";
import { useScope } from "@/pages/dashboard/useScope";
import { useActiveSession } from "@/session/SessionProvider";

/** A tela de Shopping avisou que o acesso foi salvo. O menu relê a integração. */
export const SHOPPING_MENU_EVENT = "wedash:shopping";

/** Shopping no menu só com um quiosque. Informe de vendas só com Allos nessa filial. */
export function useShoppingMenu(): { settings: boolean; report: boolean; ready: boolean } {
  const session = useActiveSession();
  const { escopo } = useScope();
  const [tick, setTick] = useState(0);
  const [administrator, setAdministrator] = useState<ShoppingAdministrator | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener("wedash:stores", refresh);
    window.addEventListener(SHOPPING_MENU_EVENT, refresh);
    return () => {
      window.removeEventListener("wedash:stores", refresh);
      window.removeEventListener(SHOPPING_MENU_EVENT, refresh);
    };
  }, []);

  const storeId = escopo.filialIds[0] ?? null;
  const catalog = storesForSession(session.stores);
  const known = session.stores.length === 0 || catalog.length > 0;
  const loja = catalog.find((store) => store.id === storeId) ?? null;
  const kiosk = loja?.pointType === "SHOPPING";

  useEffect(() => {
    if (!known) return;
    if (!kiosk || !storeId) {
      setAdministrator(null);
      setLoaded(true);
      return;
    }
    let cancel = false;
    setLoaded(false);
    void fetchShoppingAccount(session.tenantId, storeId)
      .then((account) => {
        if (!cancel) setAdministrator(account?.administrator ?? null);
      })
      .catch(() => {
        if (!cancel) setAdministrator(null);
      })
      .finally(() => {
        if (!cancel) setLoaded(true);
      });
    return () => {
      cancel = true;
    };
  }, [known, kiosk, storeId, session.tenantId, tick]);

  const menu = shoppingMenu({ kiosk, administrator: loaded ? administrator : null });
  return { ...menu, ready: known && loaded };
}
