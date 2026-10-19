import { useState } from "react";
import { Button, Modal, Tooltip } from "@/components/ui";
import { boardShareUrl, ensureBoardShare } from "@/data/wedash/boardShare";
import { useScope } from "@/pages/dashboard/useScope";

const ICON_SHARE = "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13";

export function BoardShareButton() {
  const { scope } = useScope();
  const storeId = scope.storeIds.length === 1 ? scope.storeIds[0]! : null;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function show() {
    setOpen(true);
    setCopied(false);
    setFailed(false);
    setUrl(null);
    if (!storeId) return;
    setBusy(true);
    const token = await ensureBoardShare(storeId);
    setBusy(false);
    if (!token) {
      setFailed(true);
      return;
    }
    setUrl(boardShareUrl(token));
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <Tooltip label="Compartilhar o placar" side="bottom">
        <button
          type="button"
          aria-label="Compartilhar o placar"
          onClick={() => void show()}
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICON_SHARE} />
          </svg>
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Compartilhar placar"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={!url} onClick={() => void copy()}>
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button
              disabled={!url}
              onClick={() => {
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              Abrir
            </Button>
          </div>
        }
      >
        {storeId == null ? (
          <p className="text-sm text-t2">Escolha uma filial no topo para gerar o link do placar.</p>
        ) : busy ? (
          <p className="text-sm text-t2">Gerando o link…</p>
        ) : failed ? (
          <p className="text-sm text-t2">Não foi possível gerar o link. Tente novamente.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-t2">Qualquer pessoa com este link vê o placar desta filial, sem precisar entrar.</p>
            <input
              readOnly
              value={url ?? ""}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded-[10px] border border-line bg-bg-1 px-3 py-2 font-mono text-[12.5px] text-t0"
            />
          </div>
        )}
      </Modal>
    </>
  );
}
