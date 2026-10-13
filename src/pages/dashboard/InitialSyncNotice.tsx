import { Alert, Button, Spinner } from "@/components/ui";
import { useInitialSync } from "@/pages/dashboard/useInitialSync";

/**
 * Aviso logo abaixo dos filtros enquanto as vendas de hoje chegam depois de conectar o Millennium
 * (o onboarding abre o board zerado). Some sozinho ao terminar; falha oferece "Tentar novamente".
 */
export function InitialSyncNotice() {
  const { sync, retry, retrying } = useInitialSync();
  if (!sync || sync.phase === "queued") return null;

  const falhou = sync.phase === "failed";
  const title =
    sync.phase === "running"
      ? "Buscando as vendas de hoje"
      : sync.phase === "stuck"
        ? "A sincronização está demorando mais que o normal"
        : "Não foi possível buscar as vendas de hoje";
  const text =
    sync.phase === "running"
      ? "As vendas aparecerão automaticamente assim que a sincronização terminar."
      : sync.phase === "stuck"
        ? "Ainda não conseguimos iniciar a busca das vendas de hoje. Se continuar assim, fale com o suporte."
        : sync.busy
          ? "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente."
          : "Não foi possível obter as vendas no Millennium. Tente novamente em instantes.";

  return (
    <Alert
      variant={sync.phase === "running" ? "accent" : sync.phase === "stuck" ? "warning" : "danger"}
      className="mt-4"
      title={title}
      icon={
        sync.phase === "running" ? (
          <span className="mt-0.5 shrink-0">
            <Spinner size={18} />
          </span>
        ) : undefined
      }
      action={
        falhou && (
          <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
            {retrying ? "Tentando…" : "Tentar novamente"}
          </Button>
        )
      }
    >
      {text}
    </Alert>
  );
}
