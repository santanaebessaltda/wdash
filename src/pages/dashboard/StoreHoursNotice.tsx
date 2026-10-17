import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertLink } from "@/components/ui";
import { weekHoursConfigured } from "@/data/wedash/storeHours";
import { storesForSession } from "@/data/wedash/stores";
import { isOwner } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { useScope } from "@/pages/dashboard/useScope";
import { useErpConnection } from "@/pages/dashboard/ErpStatusNotice";

/**
 * Aviso (Gestor) quando alguma loja do escopo esta sem horario de funcionamento: sem ele nao ha
 * atualizacao automatica (so o botao Atualizar). Leva para Configuracoes > Loja.
 */
export function StoreHoursNotice() {
  const session = useActiveSession();
  const { scope } = useScope();
  const navigate = useNavigate();
  const { connection } = useErpConnection();
  const [, setTick] = useState(0);
  useEffect(() => {
    const onStores = () => setTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  // Integracao desligada: nada atualiza (nem o botao), o aviso da integracao ja explica.
  if (!isOwner(session.role) || connection === "disconnected" || connection === "password") return null;
  const storeRows = storesForSession(session.stores).filter(
    (s) => scope.storeIds.length === 0 || scope.storeIds.includes(s.id),
  );
  const without = storeRows.filter((s) => !weekHoursConfigured(s.hours));
  if (without.length === 0) return null;

  const title =
    without.length === 1
      ? `A filial ${without[0]!.tradeName} está sem horário de funcionamento`
      : `${without.length} filiais estão sem horário de funcionamento`;
  return (
    <Alert
      variant="warning"
      className="mt-4"
      title={title}
      action={<AlertLink onClick={() => navigate(paths.operation.hours)}>Configurar funcionamento</AlertLink>}
    >
      {without.length === 1
        ? "As vendas dessa filial só são atualizadas pelo botão Atualizar até o horário ser configurado."
        : `As vendas dessas filiais (${without.map((s) => s.tradeName).join(", ")}) só são atualizadas pelo botão Atualizar até o horário ser configurado.`}
    </Alert>
  );
}
