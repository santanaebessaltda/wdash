import { useEffect, useRef, useState } from "react";
import { Badge, Button, Input, Modal, Tooltip } from "@/components/ui";
import { boardShareUrl, ensureBoardShare } from "@/data/wedash/boardShare";
import { storesForSession, type Store } from "@/data/wedash/stores";
import { useScope } from "@/pages/dashboard/useScope";
import { useActiveSession } from "@/session/SessionProvider";

/** Mesmo desenho do item Ao vivo: ondas de transmissão. */
const ICON_LIVE = "M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0";

type ShareLink = { id: string; name: string; url: string | null; failed: boolean; copyFailed: boolean };

function storesToShare(sessionStoreIds: string[], pickedIds: string[]): Store[] {
  const order = new Map(sessionStoreIds.map((id, index) => [id, index]));
  return storesForSession(sessionStoreIds)
    .filter((store) => pickedIds.length === 0 || pickedIds.includes(store.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function BoardShareButton() {
  const session = useActiveSession();
  const { scope } = useScope();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const many = links.length > 1;

  useEffect(() => {
    return () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  async function show() {
    const rows = storesToShare(session.stores, scope.storeIds).map((store) => ({
      id: store.id,
      name: store.tradeName || store.name,
      url: null,
      failed: false,
      copyFailed: false,
    }));
    setLinks(rows);
    setCopiedId(null);
    setOpen(true);
    if (rows.length === 0) return;
    setBusy(true);
    const next = await Promise.all(
      rows.map(async (row) => {
        const token = await ensureBoardShare(row.id);
        return token ? { ...row, url: boardShareUrl(token), failed: false } : { ...row, failed: true };
      }),
    );
    setLinks(next);
    setBusy(false);
  }

  async function copy(row: ShareLink) {
    if (!row.url) return;
    try {
      await navigator.clipboard.writeText(row.url);
      setCopiedId(row.id);
      setLinks((current) => current.map((item) => (item.id === row.id ? { ...item, copyFailed: false } : item)));
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setLinks((current) => current.map((item) => (item.id === row.id ? { ...item, copyFailed: true } : item)));
    }
  }

  return (
    <>
      <Tooltip label="Compartilhar ao vivo" side="bottom">
        <button
          type="button"
          aria-label="Compartilhar ao vivo"
          onClick={() => void show()}
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICON_LIVE} />
          </svg>
        </button>
      </Tooltip>
      <Modal open={open} onClose={() => setOpen(false)} title="Compartilhar ao vivo">
        {links.length === 0 ? (
          <p className="text-sm text-t2">Não há filiais disponíveis para este acesso.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-t2">
              {many
                ? "Cada filial tem o próprio link. Qualquer pessoa com o link vê o placar, sem fazer login."
                : "Qualquer pessoa com este link vê o placar desta filial, sem fazer login."}
            </p>
            <div>
              {links.map((row) => (
                <div key={row.id} className="flex flex-col gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
                  {many ? (
                    <Badge variant="neutral" title={row.name} className="max-w-full self-start overflow-hidden">
                      <span className="truncate">{row.name}</span>
                    </Badge>
                  ) : null}
                  <div className="relative">
                    <Input
                      readOnly
                      value={row.url ?? ""}
                      placeholder={busy && !row.url ? "Gerando o link…" : ""}
                      aria-label={many ? `Link de ${row.name}` : "Link do placar"}
                      onFocus={(event) => event.currentTarget.select()}
                      className="pr-[5.75rem] font-mono text-[12px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="absolute top-1/2 right-1 -translate-y-1/2"
                      disabled={!row.url}
                      onClick={() => void copy(row)}
                    >
                      {copiedId === row.id ? "Copiado" : "Copiar"}
                    </Button>
                  </div>
                  {row.failed ? <p className="text-[12.5px] font-semibold text-bad">Não foi possível gerar o link. Tente novamente.</p> : null}
                  {row.copyFailed ? <p className="text-[12.5px] font-semibold text-bad">Não foi possível copiar o link.</p> : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
