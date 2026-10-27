import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui";

type Props = { children: ReactNode };
type State = { failed: boolean };

const BOUNDARY_RELOAD_KEY = "wedash.boundary-reload";

function isChunkLoadError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error ?? "");
  return /Loading chunk|Failed to fetch|dynamically imported module|Importing a module script failed|error loading dynamically imported module|CSS_CHUNK_LOAD_FAILED/i.test(
    msg,
  );
}

/**
 * Chunk lazy que falhou apos o reload automatico: em vez de tela branca,
 * tenta 1 reload e, se ainda falhar, mostra um botao para recarregar.
 * Tambem captura erros de render das telas (ex.: Date invalido do cache).
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ChunkErrorBoundary:", error, info.componentStack);
    if (!isChunkLoadError(error)) return;
    try {
      const n = Number(sessionStorage.getItem(BOUNDARY_RELOAD_KEY) || "0");
      if (n < 1) {
        sessionStorage.setItem(BOUNDARY_RELOAD_KEY, String(n + 1));
        window.location.reload();
      } else {
        sessionStorage.removeItem(BOUNDARY_RELOAD_KEY);
      }
    } catch {
      /* private mode */
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex flex-col items-start gap-3 py-10" role="alert">
          <p className="text-sm font-semibold text-t0">Não foi possível abrir esta tela.</p>
          <p className="text-xs text-t2">Recarregue a página para tentar de novo.</p>
          <Button
            type="button"
            onClick={() => {
              try {
                sessionStorage.removeItem(BOUNDARY_RELOAD_KEY);
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
          >
            Recarregar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
