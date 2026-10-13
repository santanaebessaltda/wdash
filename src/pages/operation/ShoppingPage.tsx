import { useEffect, useState } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Skeleton, useToast } from "@/components/ui";
import { fetchShoppingAccount, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SHOPPING_MENU_EVENT } from "@/layout/useShoppingMenu";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";

const SENHA_SALVA = "••••••••";

/** Configurações > Shopping. O card da Allos abre a modal, no mesmo desenho de Adquirentes. */
export function ShoppingPage() {
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showSkeleton = useMinSkeleton(lojasLoading);
  const loja = lojas[0];
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (lojasLoading || escolher || !loja || loja.pointType !== "SHOPPING") {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    void fetchShoppingAccount(session.tenantId, loja.id)
      .then((access) => {
        if (!cancel) setAccount(access?.administrator === "allos" ? access : null);
      })
      .catch(() => {
        if (!cancel) show("Não foi possível carregar o shopping desta filial. Tente novamente.", "danger");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // show do toast muda de identidade; a carga segue a filial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojasLoading, escolher, loja, session.tenantId]);

  const conectado = account != null;
  const estado = conectado ? "Conectado" : "Não configurado";
  const tom = conectado ? "text-ok" : "text-t2";
  const dot = conectado ? "bg-ok" : "bg-t2";

  return (
    <div>
      <SectionHeader
        section="Configurações"
        title="Shopping"
        subtitle="Conecte a Allos desta filial para informar as vendas no shopping."
      />
      {escolher ? (
        <div className="mt-6 max-w-[720px]">
          <SelectStoreCard />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showSkeleton || (loading && loja?.pointType === "SHOPPING") ? (
            <Card>
              <div className="mb-3.5 flex items-center gap-3" aria-busy="true" aria-label="Carregando shopping…">
                <Skeleton className="h-[46px] w-[46px] rounded-[13px]" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-2 h-3 w-40" />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line pt-3">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-8 w-24 rounded-[var(--radius-vela-sm)]" />
              </div>
            </Card>
          ) : !loja ? (
            <Card>
              <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
            </Card>
          ) : loja.pointType !== "SHOPPING" ? (
            <Card>
              <EmptyBlock icon="🏬" title="Quiosque em shopping" description="Esta tela vale para filial que é quiosque em shopping." />
            </Card>
          ) : (
            <Card>
              <div className="mb-3.5 flex items-center gap-3">
                <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-line bg-bg-inset">
                  <img src="/allos.png" alt="Allos" className="h-full w-full object-contain p-1.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-t0">Allos</p>
                  <p className="mt-0.5 text-[11.5px] text-t2">Informe de vendas</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className={`flex items-center gap-1.5 text-xs font-bold ${tom}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {estado}
                </span>
                <Button size="sm" onClick={() => setAberto(true)} disabled={!loja}>
                  {conectado ? "Gerenciar" : "Conectar"}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
      {loja && loja.pointType === "SHOPPING" ? (
        <AllosModal
          open={aberto}
          account={account}
          storeId={loja.id}
          onClose={() => setAberto(false)}
          onSaved={(next) => {
            setAccount(next);
            window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
            show(account ? "Allos atualizada." : "Allos conectada.", "success");
            setAberto(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AllosModal({
  open,
  account,
  storeId,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: ShoppingAccount | null;
  storeId: string;
  onClose: () => void;
  onSaved: (account: ShoppingAccount) => void;
}) {
  const { show } = useToast();
  const conectado = account != null;
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBaseUrl(account?.baseUrl ?? "");
    setUsername(account?.username ?? "");
    setPassword("");
    setMostrarSenha(false);
    setAutorizo(false);
  }, [open, account]);

  function fechar() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
    setBusy(true);
    const result = await saveShoppingAccount({ storeId, administrator: "allos", baseUrl, username, password });
    setBusy(false);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    onSaved({
      storeId,
      administrator: "allos",
      baseUrl: baseUrl.trim().replace(/\/$/, ""),
      username: username.trim(),
      lastRunAt: account?.lastRunAt ?? null,
      lastError: account?.lastError ?? "",
    });
  }

  const senhaSalva = conectado && password === "";
  const podeConectar =
    !busy && baseUrl.trim().startsWith("https://") && username.trim().length > 0 && (password.trim().length > 0 || conectado) && (conectado || autorizo);

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Allos"
      footer={
        <>
          <Button variant="outline" onClick={fechar} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void conectar()} disabled={!podeConectar}>
            {busy ? (conectado ? "Salvando…" : "Conectando…") : conectado ? "Salvar" : "Conectar"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[13.5px] leading-relaxed text-t1">
          Informe a URL, o usuário e a senha do painel desta filial. A WDash protege a senha e a usa somente para informar as vendas.
        </p>
        <FormField label="URL" required hint="Sem caminho e sem barra no final. Ex.: https://clube.allos.com.br">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://clube.allos.com.br" disabled={busy} {...noAutofill} />
        </FormField>
        <FormField label="Usuário" required>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} {...noAutofill} />
        </FormField>
        <FormField label="Senha" required={!conectado}>
          <div className="relative">
            <Input
              type="text"
              value={senhaSalva ? SENHA_SALVA : password}
              onChange={(e) => setPassword(senhaSalva ? e.target.value.replaceAll("•", "") : e.target.value)}
              placeholder="Digite a senha"
              style={secretStyle(mostrarSenha && !senhaSalva)}
              disabled={busy}
              className="pr-12"
              {...noAutofill}
            />
            {!senhaSalva ? (
            <button
              type="button"
              onClick={() => setMostrarSenha((atual) => !atual)}
              aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              disabled={busy}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
            >
              {mostrarSenha ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
            ) : null}
          </div>
        </FormField>
        {conectado ? (
          <p className="text-[12.5px] leading-relaxed text-t2">A senha já salva aparece mascarada. Digite outra só se quiser trocar.</p>
        ) : (
          <Checkbox
            label="Autorizo a WDash a usar este acesso para informar as vendas desta filial no shopping."
            checked={autorizo}
            onChange={(e) => setAutorizo(e.target.checked)}
            disabled={busy}
          />
        )}
      </div>
    </Modal>
  );
}
