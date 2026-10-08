import { Outlet, useLocation } from "react-router-dom";
import { PageHeader, TabNav } from "@/components/ui";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { isGestor } from "@/layout/nav-wedash";

/** Mesma ordem do menu do avatar. */
const TABS = [
  { label: "Meu perfil", to: paths.profile },
  { label: "Integrações", to: paths.settings.erp },
  { label: "Usuários", to: paths.settings.users },
  { label: "Logs", to: paths.settings.logs },
];

const META: Record<string, { title: string; subtitle: string }> = {
  [paths.profile]: {
    title: "Meu perfil",
    subtitle: "Gerencie seus dados, sua senha e a aparência da WDash.",
  },
  [paths.settings.stores]: {
    title: "Lojas",
    subtitle: "Configure o funcionamento de cada loja.",
  },
  [paths.settings.erp]: {
    title: "Integrações",
    subtitle: "Gerencie as conexões da WDash com seus sistemas.",
  },
  [paths.settings.users]: {
    title: "Usuários",
    subtitle: "Controle quem acessa a WDash e quais lojas cada usuário pode visualizar.",
  },
  [paths.settings.logs]: {
    title: "Logs",
    subtitle: "Acompanhe erros e avisos da sincronização com o Millennium.",
  },
};

/**
 * Shell de Conta (menu do avatar)  -  mesmo padrao Vela (TabNav).
 * Abas so para o Gestor em Meu perfil  |  Integracoes  |  Usuarios  |  Logs; Gerente ve so Meu perfil (sem abas).
 * Lojas (so por URL por enquanto) fica sem abas.
 */
export function WedashSettingsLayout() {
  const { pathname } = useLocation();
  const session = useActiveSession();
  const meta = META[pathname] ?? META[paths.settings.stores]!;
  const tabs = isGestor(session.role) && TABS.some((t) => t.to === pathname) ? TABS : [];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Conta" }, { label: meta.title }]}
        title={meta.title}
        subtitle={meta.subtitle}
      />
      {tabs.length > 0 && <TabNav items={tabs} />}
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
