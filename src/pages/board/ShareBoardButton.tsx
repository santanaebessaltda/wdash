import { useEffect, useRef, useState } from "react";
import { Button, FormField, Input, Modal, Select } from "@/components/ui";
import { boardShareUrl, ensureBoardShare } from "@/data/wedash/boardShare";

/** Lucide Share2. */
function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

/** Link público de uma filial. Com várias no seletor, a modal pede qual. */
export function ShareBoardButton({ stores }: { stores: { id: string; tradeName: string }[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(stores[0]?.id ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const loadGen = useRef(0);

  useEffect(() => {
    return () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  async function load(storeId: string) {
    const mine = ++loadGen.current;
    setUrl(null);
    setFailed(false);
    setCopied(false);
    setCopyFailed(false);
    setBusy(true);
    const token = await ensureBoardShare(storeId);
    if (mine !== loadGen.current) return;
    if (!token) {
      setFailed(true);
      setBusy(false);
      return;
    }
    setUrl(boardShareUrl(token));
    setBusy(false);
  }

  function show() {
    const storeId = stores[0]?.id;
    if (!storeId) return;
    setPicked(storeId);
    setOpen(true);
    void load(storeId);
  }

  function choose(storeId: string) {
    setPicked(storeId);
    void load(storeId);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  const error = failed
    ? "Não foi possível gerar o link. Tente novamente."
    : copyFailed
      ? "Não foi possível copiar o link. Tente novamente."
      : undefined;

  return (
    <>
      <Button type="button" variant="outline" icon={<ShareIcon />} onClick={() => void show()}>
        Compartilhar placar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Compartilhar placar">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-t2">Qualquer pessoa com este link pode ver o placar desta filial sem fazer login.</p>
          {stores.length > 1 ? (
            <FormField label="Filial">
              <Select value={picked} onChange={(event) => choose(event.target.value)} aria-label="Filial do link">
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.tradeName}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          <FormField label="Link do placar" error={error}>
            <div className="relative">
              <Input
                readOnly
                value={url ?? ""}
                placeholder={busy ? "Gerando link…" : ""}
                aria-label="Link do placar"
                onFocus={(event) => event.currentTarget.select()}
                className="pr-[5.75rem] font-mono text-[12px]"
              />
              <Button type="button" size="sm" className="absolute top-1/2 right-1 -translate-y-1/2" disabled={!url} onClick={() => void copy()}>
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </FormField>
        </div>
      </Modal>
    </>
  );
}
