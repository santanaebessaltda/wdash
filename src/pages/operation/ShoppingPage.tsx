import { useEffect, useState } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Skeleton, useToast } from "@/components/ui";
import { INTRANET_MALL_ORIGIN, intranetMallBaseUrl, intranetMallSlug } from "@/data/wedash/shoppingReport";
import { fetchShoppingAccount, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { cn } from "@/lib/cn";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SHOPPING_MENU_EVENT } from "@/layout/useShoppingMenu";
import { GroupComModal } from "@/pages/operation/GroupComModal";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";

/** Configurações > Shopping. O card da Intranet Mall abre a modal, no mesmo desenho de Adquirentes. */
export function ShoppingPage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showSkeleton = useMinSkeleton(storesLoading);
  const store = storeRows[0];
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  useEffect(() => {
    if (storesLoading || escolher || !store || store.pointType !== "SHOPPING") {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    void fetchShoppingAccount(session.tenantId, store.id)
      .then((access) => {
        if (!cancel) setAccount(access);
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
  }, [storesLoading, escolher, store, session.tenantId]);

  const intranet = account?.administrator === "allos" ? account : null;
  const group = account?.administrator === "groupcom" ? account : null;

  return (
    <div>
      <SectionHeader
        section="Configurações"
        title="Shopping"
        subtitle="Configure o acesso à administradora do shopping desta filial."
      />
      {escolher ? (
        <div className="mt-6 max-w-[720px]">
          <SelectStoreCard />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showSkeleton || (loading && store?.pointType === "SHOPPING") ? (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          ) : !store ? (
            <Card>
              <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
            </Card>
          ) : store.pointType !== "SHOPPING" ? (
            <Card>
              <EmptyBlock icon="🏬" title="Shopping indisponível" description="Esta tela está disponível apenas para filiais do tipo Quiosque em shopping." />
            </Card>
          ) : (
            <>
              <ShoppingCard logo="/intranet.png" name="Intranet Mall" detail="Informe de vendas" connected={intranet != null} onOpen={() => setOpen(true)} />
              <ShoppingCard
                logo="/group-com.png"
                name="Group COM"
                detail={group?.unit ? [group.unit.floor, group.unit.code].filter(Boolean).join(" / ") : "Informe de vendas"}
                connected={group != null}
                onOpen={() => setGroupOpen(true)}
              />
            </>
          )}
        </div>
      )}
      {store && store.pointType === "SHOPPING" ? (
        <>
        <IntranetMallModal
          open={open}
          account={intranet}
          replacesOther={group != null}
          storeId={store.id}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setAccount(next);
            window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
            show(intranet ? "Alterações salvas." : "Acesso da Intranet Mall configurado.", "success");
            setOpen(false);
          }}
        />
        <GroupComModal
          open={groupOpen}
          account={group}
          replacesOther={account != null && account.administrator !== "groupcom"}
          storeId={store.id}
          onClose={() => setGroupOpen(false)}
          onSaved={(next) => {
            setAccount(next);
            window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
            show(group ? "Alterações salvas." : "Acesso do Group COM configurado.", "success");
            setGroupOpen(false);
          }}
        />
        </>
      ) : null}
    </div>
  );
}

function CardSkeleton() {
  return (
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
  );
}

function ShoppingCard({ logo, name, detail, connected, onOpen }: { logo: string; name: string; detail: string; connected: boolean; onOpen: () => void }) {
  const status = connected ? "Configurado" : "Não configurado";
  const tone = connected ? "text-ok" : "text-t2";
  const dot = connected ? "bg-ok" : "bg-t2";
  return (
    <Card>
      <div className="mb-3.5 flex items-center gap-3">
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-line bg-bg-inset">
          <img src={logo} alt={name} className="h-full w-full object-contain p-1.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold text-t0">{name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-t2">{detail}</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className={`flex items-center gap-1.5 text-xs font-bold ${tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {status}
        </span>
        <Button size="sm" onClick={onOpen}>
          {connected ? "Gerenciar" : "Configurar"}
        </Button>
      </div>
    </Card>
  );
}

function slugFieldValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("://") || trimmed.toLowerCase().includes("intranetmall.com")) {
    return intranetMallSlug(trimmed) ?? trimmed.replace(/^https?:\/\//i, "").replace(/^app3\.intranetmall\.com\/?/i, "").replace(/\/+$/, "");
  }
  return value.replace(/\s/g, "").replace(/^\/+|\/+$/g, "");
}

function IntranetMallModal({
  open,
  account,
  replacesOther,
  storeId,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: ShoppingAccount | null;
  replacesOther: boolean;
  storeId: string;
  onClose: () => void;
  onSaved: (account: ShoppingAccount) => void;
}) {
  const { show } = useToast();
  const conectado = account != null;
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseUrl = intranetMallBaseUrl(slug);

  useEffect(() => {
    if (!open) return;
    setSlug(account ? (intranetMallSlug(account.baseUrl) ?? "") : "");
    setUsername(account?.username ?? "");
    setPassword("");
    setShowPassword(false);
    setAutorizo(false);
  }, [open, account]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
    setBusy(true);
    if (!baseUrl) {
      setBusy(false);
      return;
    }
    const result = await saveShoppingAccount({ storeId, administrator: "allos", baseUrl, username, password });
    setBusy(false);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    onSaved({
      storeId,
      administrator: "allos",
      baseUrl,
      username: username.trim(),
      lastRunAt: account?.lastRunAt ?? null,
      lastError: account?.lastError ?? "",
      unit: null,
    });
  }

  const slugError = slug.length > 0 && !baseUrl ? "Use o slug da filial, como shoppingcampogrande4." : undefined;
  const canConectar =
    !busy && baseUrl != null && username.trim().length > 0 && (password.trim().length > 0 || conectado) && (conectado || autorizo);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Intranet Mall"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void conectar()} disabled={!canConectar}>
            {busy ? "Salvando…" : conectado ? "Salvar alterações" : "Salvar acesso"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[13.5px] leading-relaxed text-t1">
          Informe o slug e o acesso da Intranet Mall desta filial. A WDash protege esses dados e os usa somente para informar as vendas ao shopping.
        </p>
        {replacesOther ? (
          <p className="text-[13px] leading-relaxed text-t1">Salvar aqui passa a valer no lugar do acesso do Group COM desta filial.</p>
        ) : null}
        <FormField
          label="Slug"
          required
          error={slugError}
          hint="Abra a Intranet Mall no navegador e copie o trecho do endereço depois de intranetmall.com/. Em https://app3.intranetmall.com/shoppingcampogrande4/ o slug é shoppingcampogrande4."
        >
          <div className={cn("flex flex-col overflow-hidden rounded-[var(--radius-vela-md)] border bg-bg-inset focus-within:border-acc sm:h-[42px] sm:flex-row", slugError ? "border-bad" : "border-line")}>
            <span className="flex shrink-0 items-center border-b border-line bg-bg-3 px-3 py-2 text-[12px] text-t2 sm:border-b-0 sm:border-r sm:py-0">
              {INTRANET_MALL_ORIGIN.replace("https://", "")}/
            </span>
            <input
              value={slug}
              onChange={(e) => setSlug(slugFieldValue(e.target.value))}
              placeholder="shoppingcampogrande4"
              disabled={busy}
              className="h-[42px] min-w-0 flex-1 bg-transparent px-3 text-[13px] text-t0 outline-none placeholder:text-t2"
              {...noAutofill}
            />
          </div>
        </FormField>
        <FormField label="Usuário" required>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} {...noAutofill} />
        </FormField>
        <FormField
          label="Senha"
          required={!conectado}
          hint={conectado ? "Digite uma nova senha somente se quiser alterar a atual." : undefined}
        >
          <div className="relative">
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={conectado ? "Senha já cadastrada" : "Digite a senha"}
              style={secretStyle(showPassword && password.length > 0)}
              disabled={busy}
              className={!conectado || password.length > 0 ? "pr-12" : undefined}
              {...noAutofill}
            />
            {!conectado || password.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              disabled={busy}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
            >
              {showPassword ? (
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
        {!conectado && (
          <Checkbox
            label="Autorizo a WDash a usar este acesso para informar as vendas desta filial ao shopping."
            checked={autorizo}
            onChange={(e) => setAutorizo(e.target.checked)}
            disabled={busy}
          />
        )}
      </div>
    </Modal>
  );
}
