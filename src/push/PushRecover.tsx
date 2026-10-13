import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useActiveSession } from "@/session/SessionProvider";
import { enableSalesPush } from "./salesPush";

const DISPENSADO = "wedash.push-recover-dismissed";

function blocked(): boolean {
  return "Notification" in window && Notification.permission === "denied";
}

function passos(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "Abra Ajustes, Notificações, WDash e ligue Permitir Notificações. A WDash precisa estar aberta pelo ícone da Tela de Início. Depois volte e toque em Tentar de novo.";
  }
  if (/Android/i.test(ua)) {
    return "Toque no cadeado ao lado do endereço, abra as permissões do site e ligue Notificações. Depois volte e toque em Tentar de novo.";
  }
  return "Clique no cadeado na barra de endereço, abra as permissões do site e ligue Notificações. Depois clique em Tentar de novo.";
}

/** Quem recusou o aviso do sistema não recebe outro pedido. Este aviso mostra como ligar de novo. */
export function PushRecover() {
  const session = useActiveSession();
  const [open, setOpen] = useState(false);
  const [still, setStill] = useState(false);
  const [tentando, setTentando] = useState(false);

  useEffect(() => {
    if (session.role === "SELLER") return;
    try {
      if (sessionStorage.getItem(DISPENSADO) === "1") return;
    } catch {
      /* private mode */
    }
    if (blocked()) setOpen(true);
  }, [session.role]);

  function dispensar() {
    setOpen(false);
    try {
      sessionStorage.setItem(DISPENSADO, "1");
    } catch {
      /* private mode */
    }
  }

  async function retry() {
    setTentando(true);
    setStill(false);
    const r = await enableSalesPush(session.tenantId);
    setTentando(false);
    if (r === "ok") {
      setOpen(false);
      return;
    }
    setStill(true);
  }

  if (session.role === "SELLER") return null;

  return (
    <Modal
      open={open}
      onClose={dispensar}
      size="sm"
      title="Avisos desativados"
      footer={
        <>
          <Button variant="outline" onClick={dispensar}>
            Agora não
          </Button>
          <Button disabled={tentando} onClick={() => void retry()}>
            {tentando ? "Verificando…" : "Tentar de novo"}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-t1">
        O celular ou o navegador não pergunta de novo depois do Não. {passos()}
      </p>
      {still && <p className="mt-3 text-[13px] text-t2">Ainda está desativado neste aparelho.</p>}
    </Modal>
  );
}
