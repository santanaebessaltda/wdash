import { useState } from "react";
import { Button, FormField, Input, Modal, useToast } from "@/components/ui";
import { inviteSeller, copySellerInviteLink } from "@/data/wedash/sellerAccess";
import { normalizeEmail, validEmail } from "@/data/wedash/engine/sellerAccess";

/**
 * Convite de acesso do vendedor. O e-mail vem preenchido da ficha da WDash.
 * Depois de enviar, oferece o mesmo link do e-mail para copiar.
 * Cada vendedor monta o formulário de novo: o "enviado" de um não fica no próximo.
 */
export function InviteSellerModal(props: {
  seller: { id: string; name: string; email: string | null } | null;
  onClose: () => void;
  onDone: () => void;
  onInvited: (sellerId: string, email: string) => void;
}) {
  return <InviteSellerForm key={props.seller?.id ?? "closed"} {...props} />;
}

function InviteSellerForm({
  seller,
  onClose,
  onDone,
  onInvited,
}: {
  seller: { id: string; name: string; email: string | null } | null;
  onClose: () => void;
  onDone: () => void;
  onInvited: (sellerId: string, email: string) => void;
}) {
  const { show } = useToast();
  const [email, setEmail] = useState(seller?.email ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeEmail(email);
  const invalid = email.trim().length > 0 && !validEmail(normalized);

  async function send() {
    if (!seller || !validEmail(normalized)) {
      setError("Informe um e-mail válido.");
      return;
    }
    setSending(true);
    const r = await inviteSeller(seller.id, normalized);
    setSending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    if (r.linked) {
      show("Acesso liberado também nesta filial.", "success");
      onDone();
      return;
    }
    onInvited(seller.id, normalized);
    setSent(true);
    show("Convite enviado.", "success");
  }

  async function copyLink() {
    if (!seller) return;
    const r = await copySellerInviteLink(seller.id);
    if (!r.ok || !r.token) {
      show(r.ok ? "O link do convite não está mais disponível. Reenvie o convite." : r.message, "danger");
      return;
    }
    try {
      await navigator.clipboard.writeText(r.token);
      show("Link copiado.", "success");
    } catch {
      show("Não foi possível copiar o link. Tente novamente.", "danger");
    }
  }

  return (
    <Modal
      open={seller != null}
      onClose={onClose}
      title={seller ? `Convidar ${seller.name}` : ""}
      footer={
        sent ? (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button type="button" onClick={() => void copyLink()}>
              Copiar link do convite
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={sending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void send()} disabled={sending || !validEmail(normalized)}>
              {sending ? "Enviando…" : "Enviar convite"}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <p className="text-[13.5px] text-t1">
          O convite foi enviado para <span className="font-semibold text-t0">{normalized}</span>. Você também pode copiar o
          link e enviá-lo por outro canal.
        </p>
      ) : (
        <FormField label="E-mail" required error={error ?? (invalid ? "Informe um e-mail válido." : undefined)}>
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="nome@email.com"
            autoFocus
          />
        </FormField>
      )}
    </Modal>
  );
}
