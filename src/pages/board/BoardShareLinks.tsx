import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, FormField, Input } from "@/components/ui";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import { boardShareUrl, ensureBoardShare } from "@/data/wedash/boardShare";

type ShareRow = {
  id: string;
  tradeName: string;
  url: string | null;
  busy: boolean;
  failed: boolean;
  copied: boolean;
  copyFailed: boolean;
};

function idleRow(store: { id: string; tradeName: string }): ShareRow {
  return { id: store.id, tradeName: store.tradeName, url: null, busy: true, failed: false, copied: false, copyFailed: false };
}

/** Links públicos do placar para as filiais do seletor. Não existe placar consolidado. */
export function BoardShareLinks({ stores }: { stores: { id: string; tradeName: string }[] }) {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const copiedTimers = useRef<Map<string, number>>(new Map());
  const loadGen = useRef(0);
  const storeKey = stores.map((s) => s.id).join(",");

  useEffect(() => {
    const timers = copiedTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (stores.length === 0) {
      setRows([]);
      return;
    }
    const list = stores;
    const mine = ++loadGen.current;
    setRows(list.map(idleRow));
    void Promise.all(
      list.map(async (store) => {
        const token = await ensureBoardShare(store.id);
        if (mine !== loadGen.current) return;
        setRows((current) =>
          current.map((row) =>
            row.id === store.id
              ? { ...row, busy: false, failed: !token, url: token ? boardShareUrl(token) : null }
              : row,
          ),
        );
      }),
    );
  }, [storeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy(storeId: string) {
    const row = rows.find((item) => item.id === storeId);
    if (!row?.url) return;
    try {
      await navigator.clipboard.writeText(row.url);
      setRows((current) => current.map((item) => (item.id === storeId ? { ...item, copied: true, copyFailed: false } : item)));
      const previous = copiedTimers.current.get(storeId);
      if (previous != null) window.clearTimeout(previous);
      copiedTimers.current.set(
        storeId,
        window.setTimeout(() => {
          copiedTimers.current.delete(storeId);
          setRows((current) => current.map((item) => (item.id === storeId ? { ...item, copied: false } : item)));
        }, 2000),
      );
    } catch {
      setRows((current) => current.map((item) => (item.id === storeId ? { ...item, copied: false, copyFailed: true } : item)));
    }
  }

  if (stores.length === 0) {
    return (
      <EmptyState framed={false} icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
    );
  }

  const many = stores.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-t2">
        {many
          ? "Cada filial tem seu próprio link. Qualquer pessoa com o link pode ver o placar sem fazer login."
          : "Qualquer pessoa com este link pode ver o placar desta filial sem fazer login."}
      </p>
      {rows.map((row) => {
        const error = row.failed
          ? "Não foi possível gerar o link. Tente novamente."
          : row.copyFailed
            ? "Não foi possível copiar o link. Tente novamente."
            : undefined;
        return (
          <div key={row.id} className="flex flex-col gap-1.5">
            {many ? <StoreDivisionTitle>{row.tradeName}</StoreDivisionTitle> : null}
            <FormField label={many ? undefined : "Link do placar"} error={error}>
              <div className="relative">
                <Input
                  readOnly
                  value={row.url ?? ""}
                  placeholder={row.busy ? "Gerando link…" : ""}
                  aria-label={many ? `Link do placar de ${row.tradeName}` : "Link do placar"}
                  onFocus={(event) => event.currentTarget.select()}
                  className="pr-[5.75rem] font-mono text-[12px]"
                />
                <Button
                  type="button"
                  size="sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  disabled={!row.url}
                  onClick={() => void copy(row.id)}
                >
                  {row.copied ? "Copiado" : "Copiar"}
                </Button>
              </div>
            </FormField>
          </div>
        );
      })}
    </div>
  );
}
