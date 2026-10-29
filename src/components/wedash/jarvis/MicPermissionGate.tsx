import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { queryMicPermission, requestMicAccess } from "./micPermission";

const DISMISS_KEY = "wedash.jarvis.micPromptDismissed";

type Props = {
  /** Só Gestor + desktop (palmas em qualquer página). */
  active: boolean;
  /** Chamado quando o mic fica liberado (clap pode subir). */
  onGranted: () => void;
};

/**
 * Na entrada do WDash (Gestor desktop): modal com botão Permitir.
 * O Chrome só mostra o popup nativo no gesto do clique — mount sozinho não basta.
 */
export function MicPermissionGate({ active, onGranted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setOpen(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const state = await queryMicPermission();
      if (cancelled) return;
      if (state === "granted") {
        onGranted();
        return;
      }
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
      // denied: ainda mostra — o botão leva ao popup ou à dica de desbloquear.
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, onGranted]);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
    setError(null);
  };

  const allow = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      const result = await requestMicAccess();
      setBusy(false);
      if (result === "granted") {
        sessionStorage.removeItem(DISMISS_KEY);
        setOpen(false);
        onGranted();
        return;
      }
      if (result === "denied") {
        setError("Microfone bloqueado neste site.");
        return;
      }
      setError("Não consegui abrir o microfone neste aparelho.");
    })();
  };

  return (
    <Modal
      open={open}
      onClose={dismiss}
      size="sm"
      title="Microfone do JARVIS"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={dismiss} disabled={busy}>
            Agora não
          </Button>
          <Button type="button" size="sm" onClick={allow} disabled={busy}>
            {busy ? "Pedindo…" : "Permitir microfone"}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-t2">
        Com o microfone liberado, duas palmas em qualquer tela abrem o JARVIS. Sem isso, o Chrome
        não deixa ouvir — e o pedido só aparece depois de um clique.
      </p>
      {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}
    </Modal>
  );
}
