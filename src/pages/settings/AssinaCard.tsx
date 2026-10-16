import { useEffect, useState } from "react";
import { Button, Card, Modal, Skeleton, useToast } from "@/components/ui";
import { DOCUMENT_COPY } from "@/data/wedash/documentSplit";
import { fetchAssinaStatus, saveAssinaToken } from "@/data/wedash/documentsRepo";
import { isOwner } from "@/layout/nav-wedash";
import { useActiveSession } from "@/session/SessionProvider";

/** Card da empresa. O token não volta depois de salvo. */
export function AssinaCard() {
  const session = useActiveSession();
  const { show } = useToast();
  const [status, setStatus] = useState<"connected" | "not_configured" | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = isOwner(session.role);

  useEffect(() => {
    void fetchAssinaStatus().then(setStatus);
  }, []);

  async function connect() {
    setBusy(true);
    const result = await saveAssinaToken(token.trim());
    setBusy(false);
    if (!result.ok) {
      show(result.message || DOCUMENT_COPY.badToken, "danger");
      return;
    }
    setToken("");
    setStatus("connected");
    setOpen(false);
    show("Assina AI conectado.", "success");
  }

  return (
    <>
      <Card>
        <div className="mb-3.5 flex items-center gap-3">
          <span className="flex h-[46px] w-[120px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-bg-inset px-2">
            <img src="/assinaai.png" alt="Assina AI" className="h-7 w-auto max-w-[104px] object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold text-t0">Assina AI</p>
            <p className="mt-0.5 text-[11.5px] text-t2">Assinatura de documentos · todas as filiais</p>
          </div>
        </div>
        {status == null ? (
          <div className="flex items-center justify-between border-t border-line pt-3" aria-busy="true">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-24 rounded-[var(--radius-vela-sm)]" />
          </div>
        ) : (
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className={`flex items-center gap-1.5 text-xs font-bold ${status === "connected" ? "text-ok" : "text-t2"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status === "connected" ? "bg-ok" : "bg-t2"}`} />
              {status === "connected" ? "Conectado" : "Desconectado"}
            </span>
            <Button size="sm" variant={status === "connected" ? "outline" : "primary"} onClick={() => setOpen(true)} disabled={!canEdit}>
              {status === "connected" ? "Gerenciar" : "Conectar"}
            </Button>
          </div>
        )}
      </Card>
      <Modal
        open={open}
        title="Assina AI"
        onClose={() => setOpen(false)}
        footer={
          <Button onClick={() => void connect()} disabled={busy || !token.trim()}>
            {busy ? "Conectando…" : "Conectar"}
          </Button>
        }
      >
        <label className="text-xs font-semibold text-t1">
          Token da API
          <input
            type="password"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={status === "connected" ? "Cole um token novo para substituir" : "sk_live_"}
          />
        </label>
        <p className="mt-2 text-xs text-t2">Vale para todas as filiais. O token não aparece de novo depois de salvo.</p>
      </Modal>
    </>
  );
}
