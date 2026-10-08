import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertLink } from "@/components/ui";
import { weekHoursConfigured } from "@/data/wedash/storeHours";
import { storesForSession } from "@/data/wedash/stores";
import { isGestor } from "@/layout/nav-wedash";
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
  const { escopo } = useScope();
  const navigate = useNavigate();
  const { connection } = useErpConnection();
  const [, setTick] = useState(0);
  useEffect(() => {
    const onStores = () => setTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  // Integracao desligada: nada atualiza (nem o botao), o aviso da integracao ja explica.
  if (!isGestor(session.role) || connection === "disconnected" || connection === "password") return null;
  const lojas = storesForSession(session.stores).filter(
    (s) => escopo.filialIds.length === 0 || escopo.filialIds.includes(s.id),
  );
  const sem = lojas.filter((s) => !weekHoursConfigured(s.horas));
  if (sem.length === 0) return null;

  const titulo =
    sem.length === 1
      ? `A loja ${sem[0]!.fantasia} está sem horário de funcionamento`
      : `${sem.length} lojas estão sem horário de funcionamento`;
  return (
    <Alert
      variant="warning"
      className="mt-4"
      title={titulo}
      action={<AlertLink onClick={() => navigate(paths.operation.store)}>Configurar funcionamento</AlertLink>}
    >
      {sem.length === 1
        ? "As vendas dessa loja só são atualizadas pelo botão Atualizar até o horário ser configurado."
        : `As vendas dessas lojas (${sem.map((s) => s.fantasia).join(", ")}) só são atualizadas pelo botão Atualizar até o horário ser configurado.`}
    </Alert>
  );
}
