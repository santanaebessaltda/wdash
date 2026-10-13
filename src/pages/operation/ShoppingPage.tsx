import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, FormField, Input, Select, Skeleton, useToast } from "@/components/ui";
import { fetchShoppingAccount, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import type { ShoppingAdministrator } from "@/data/wedash/shoppingReport";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SHOPPING_MENU_EVENT, useShoppingMenu } from "@/layout/useShoppingMenu";
import { paths } from "@/router/paths";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";

/** Configurações > Shopping. URL, usuário e senha do quiosque. A senha não volta depois de salva. */
export function ShoppingPage() {
  const navigate = useNavigate();
  const menu = useShoppingMenu();
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showSkeleton = useMinSkeleton(lojasLoading);
  const loja = lojas[0];
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [administrator, setAdministrator] = useState<ShoppingAdministrator>("allos");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lojasLoading || escolher || !loja || loja.pointType !== "SHOPPING") {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    void fetchShoppingAccount(session.tenantId, loja.id)
      .then((access) => {
        if (cancel) return;
        setAccount(access);
        setAdministrator(access?.administrator ?? "allos");
        setBaseUrl(access?.baseUrl ?? "");
        setUsername(access?.username ?? "");
        setPassword("");
        setMostrarSenha(false);
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

  useEffect(() => {
    if (!menu.ready || menu.settings) return;
    navigate(paths.operation.filial, { replace: true });
  }, [menu.ready, menu.settings, navigate]);

  async function salvar() {
    if (!loja) return;
    setBusy(true);
    const result = await saveShoppingAccount({ storeId: loja.id, administrator, baseUrl, username, password });
    setBusy(false);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    setPassword("");
    setMostrarSenha(false);
    setAccount({
      storeId: loja.id,
      administrator,
      baseUrl: baseUrl.trim().replace(/\/$/, ""),
      username: username.trim(),
      lastRunAt: account?.lastRunAt ?? null,
      lastError: account?.lastError ?? "",
    });
    window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
    show("Shopping salvo.", "success");
  }

  const salvo = account != null;
  const podeSalvar = !busy && baseUrl.trim().startsWith("https://") && username.trim().length > 0 && (password.trim().length > 0 || salvo);

  if (menu.ready && !menu.settings) return null;

  return (
    <div>
      <SectionHeader
        section="Configurações"
        title="Shopping"
        subtitle="Guarde a administradora, a URL e o acesso de cada quiosque."
      />
      <div className="mt-6 max-w-[720px] pb-8">
        {escolher ? (
          <SelectStoreCard />
        ) : showSkeleton || (loading && loja?.pointType === "SHOPPING") ? (
          <Skeleton className="h-[360px] w-full rounded-[18px]" />
        ) : !loja ? (
          <Card>
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : loja.pointType !== "SHOPPING" ? (
          <Card>
            <EmptyBlock icon="🏬" title="Loja de rua" description="O informe de vendas vale para quiosque em shopping." />
          </Card>
        ) : (
          <Card>
            <div className="flex max-w-[420px] flex-col gap-3.5">
              <FormField label="Administradora" required>
                <Select value={administrator} onChange={(e) => setAdministrator(e.target.value === "argo" ? "argo" : "allos")} disabled={busy} {...noAutofill}>
                  <option value="allos">Allos</option>
                  <option value="argo">Argo</option>
                </Select>
              </FormField>
              <FormField label="URL" required>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" disabled={busy} {...noAutofill} />
              </FormField>
              <FormField label="Usuário" required>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} {...noAutofill} />
              </FormField>
              <FormField label="Senha" required={!salvo}>
                <div className="relative">
                  <Input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={salvo ? "Senha já salva" : "Digite a senha"}
                    style={secretStyle(mostrarSenha)}
                    disabled={busy}
                    className="pr-12"
                    {...noAutofill}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha((atual) => !atual)}
                    aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                    disabled={busy}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
                  >
                    {mostrarSenha ? "Ocultar" : "Ver"}
                  </button>
                </div>
              </FormField>
              <div>
                <Button onClick={() => void salvar()} disabled={!podeSalvar}>
                  {busy ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
