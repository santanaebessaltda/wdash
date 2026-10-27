import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui";

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * Chunk lazy que falhou apos o reload automatico: em vez de tela branca,
 * mostra um botao para recarregar.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ChunkErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex flex-col items-start gap-3 py-10" role="alert">
          <p className="text-sm font-semibold text-t0">Não foi possível abrir esta tela.</p>
          <p className="text-xs text-t2">Recarregue a página para tentar de novo.</p>
          <Button type="button" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
