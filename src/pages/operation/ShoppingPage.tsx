import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Skeleton, useToast } from "@/components/ui";
import {
  INTRANET_MALL_ORIGIN,
  intranetMallBaseUrl,
  intranetMallSlug,
  shoppingAdministratorName,
  type ShoppingAdministrator as MallAdministrator,
} from "@/data/wedash/shoppingReport";
import { clearShoppingAccount, fetchShoppingAccount, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { cn } from "@/lib/cn";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { isOwner } from "@/layout/nav-wedash";
import { SHOPPING_MENU_EVENT } from "@/layout/useShoppingMenu";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { useScope } from "@/pages/dashboard/useScope";
import { GroupComModal, type ShoppingFormBar } from "@/pages/operation/GroupComModal";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "./shared";

const IDLE_BAR: ShoppingFormBar = { busy: false, canSave: false, label: "Conectar" };

type MallStep = "allos" | "groupcom";

const PROVIDERS: { id: MallStep; name: string; logo: string }[] = [
  { id: "allos", name: "Intranet Mall", logo: "/intranet.png" },
  { id: "groupcom", name: "Group COM", logo: "/group-com.png" },
];

function accessPhrase(administrator: MallAdministrator): string {
  const name = shoppingAdministratorName(administrator);
  return administrator === "groupcom" ? `do ${name}` : `da ${name}`;
}

function mallDetail(account: ShoppingAccount): string {
  if (account.administrator === "groupcom") {
    const line = account.unit ? [account.unit.mall, account.unit.floor, account.unit.code].filter(Boolean).join(" · ") : "";
    return line || "Informe de vendas";
  }
  if (account.administrator === "argo") return "Integração ainda não disponível";
  const slug = intranetMallSlug(account.baseUrl);
  return slug ? `Informe de vendas · ${slug}` : "Informe de vendas";
}

/** Configurações > Administradora. Um card por administradora; a filial usa uma só. */
export function ShoppingSettingsPage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showSkeleton = useMinSkeleton(storesLoading);
  const store = storeRows.length === 1 ? storeRows[0] : null;
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [open, setOpen] = useState<MallStep | null>(null);
  const canEdit = isOwner(session.role);
  const accountReady = store != null && loadedFor === store.id;

  useEffect(() => {
    if (!store || store.pointType !== "SHOPPING") return;
    let cancel = false;
    void fetchShoppingAccount(session.tenantId, store.id)
      .then((access) => {
        if (cancel) return;
        setAccount(access);
        setLoadedFor(store.id);
      })
      .catch(() => {
        if (cancel) return;
        setAccount(null);
        setLoadedFor(store.id);
        show("Não foi possível carregar a administradora desta filial. Tente novamente.", "danger");
      });
    return () => {
      cancel = true;
    };
    // show do toast muda de identidade; a carga segue a filial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tenantId, store?.id, store?.pointType]);

  const street = store?.pointType === "STREET";

  return (
    <div>
      <SectionHeader
        section="Configurações"
        title="Administradora"
        subtitle="Conecte a administradora desta filial para informar as vendas ao shopping. Cada filial usa uma só."
      />
      {escolher || showSkeleton ? (
        escolher ? (
          <div className="mt-6 max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map((provider) => (
              <ProviderSkeleton key={provider.id} />
            ))}
          </div>
        )
      ) : !store ? (
        <Card className="mt-6">
          <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
        </Card>
      ) : street ? (
        <Card className="mt-6">
          <EmptyBlock
            icon="🏬"
            title="Administradora indisponível"
            description="Esta configuração está disponível apenas para filiais do tipo Quiosque em shopping."
          />
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!accountReady
            ? PROVIDERS.map((provider) => <ProviderSkeleton key={provider.id} />)
            : PROVIDERS.map((provider) => {
                const active = account?.administrator === provider.id ? account : null;
                return (
                  <ProviderCard
                    key={provider.id}
                    name={provider.name}
                    logo={provider.logo}
                    detail={active ? mallDetail(active) : "Informe de vendas"}
                    connected={active != null}
                    disabled={!canEdit}
                    onOpen={() => setOpen(provider.id)}
                  />
                );
              })}
        </div>
      )}
      {store && open ? (
        <AdministratorModal
          open
          step={open}
          storeId={store.id}
          account={account}
          onClose={() => setOpen(null)}
          onAccount={(next) => {
            setAccount(next);
            setLoadedFor(store.id);
          }}
        />
      ) : null}
    </div>
  );
}

function ProviderSkeleton() {
  return (
    <Card>
      <div className="mb-3.5 flex items-center gap-3" aria-busy="true" aria-label="Carregando administradora…">
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

function ProviderCard({
  name,
  logo,
  detail,
  connected,
  disabled,
  onOpen,
}: {
  name: string;
  logo: string;
  detail: string;
  connected: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
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
          {connected ? "Conectado" : "Não configurado"}
        </span>
        <Button size="sm" onClick={onOpen} disabled={disabled}>
          {connected ? "Gerenciar" : "Conectar"}
        </Button>
      </div>
    </Card>
  );
}

function AdministratorModal({
  open,
  step,
  storeId,
  account,
  onClose,
  onAccount,
}: {
  open: boolean;
  step: MallStep;
  storeId: string;
  account: ShoppingAccount | null;
  onClose: () => void;
  onAccount: (account: ShoppingAccount | null) => void;
}) {
  const { show } = useToast();
  const saveRef = useRef<() => void>(() => {});
  const [bar, setBar] = useState<ShoppingFormBar>(IDLE_BAR);
  const [removing, setRemoving] = useState(false);
  const onBar = useCallback((next: ShoppingFormBar) => {
    setBar((current) => (current.busy === next.busy && current.canSave === next.canSave && current.label === next.label ? current : next));
  }, []);

  const [removeOpen, setRemoveOpen] = useState(false);
  const locked = bar.busy || removing;
  const formAccount = account && account.administrator === step ? account : null;
  const replaced = account && account.administrator !== step ? accessPhrase(account.administrator) : null;

  function close() {
    if (locked) return;
    onClose();
  }

  function saved(next: ShoppingAccount) {
    onAccount(next);
    window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
    const editing = account?.administrator === next.administrator;
    const created = next.administrator === "groupcom" ? "Acesso do Group COM configurado." : "Acesso da Intranet Mall configurado.";
    show(editing ? "Alterações salvas." : created, "success");
    onClose();
  }

  async function remover() {
    setRemoving(true);
    const result = await clearShoppingAccount(storeId);
    setRemoving(false);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    onAccount(null);
    window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
    show("Acesso da administradora removido.", "success");
    setRemoveOpen(false);
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={shoppingAdministratorName(step)}
        footer={
          <>
            {formAccount ? (
              <Button variant="outline" className="mr-auto" onClick={() => setRemoveOpen(true)} disabled={locked}>
                Remover
              </Button>
            ) : null}
            <Button variant="outline" onClick={close} disabled={locked}>
              Cancelar
            </Button>
            <Button onClick={() => saveRef.current()} disabled={!bar.canSave}>
              {bar.label}
            </Button>
          </>
        }
      >
        {open && step === "allos" ? (
          <IntranetMallForm account={formAccount} replacedName={replaced} storeId={storeId} onSaved={saved} onBar={onBar} saveRef={saveRef} />
        ) : null}
        {open && step === "groupcom" ? (
          <GroupComModal account={formAccount} replacedName={replaced} storeId={storeId} onSaved={saved} onBar={onBar} saveRef={saveRef} />
        ) : null}
      </Modal>
      <Modal
        open={removeOpen}
        onClose={() => {
          if (!removing) setRemoveOpen(false);
        }}
        title="Remover administradora?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoveOpen(false)} disabled={removing}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void remover()} disabled={removing}>
              {removing ? "Removendo…" : "Remover"}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-t1">
          O acesso {account ? accessPhrase(account.administrator) : "salvo"} será removido. A WDash deixará de informar vendas ao shopping.
        </p>
      </Modal>
    </>
  );
}

function slugFieldValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("://") || trimmed.toLowerCase().includes("intranetmall.com")) {
    return intranetMallSlug(trimmed) ?? trimmed.replace(/^https?:\/\//i, "").replace(/^app3\.intranetmall\.com\/?/i, "").replace(/\/+$/, "");
  }
  return value.replace(/\s/g, "").replace(/^\/+|\/+$/g, "");
}

function IntranetMallForm({
  account,
  replacedName,
  storeId,
  onSaved,
  onBar,
  saveRef,
}: {
  account: ShoppingAccount | null;
  replacedName: string | null;
  storeId: string;
  onSaved: (account: ShoppingAccount) => void;
  onBar: (bar: ShoppingFormBar) => void;
  saveRef: MutableRefObject<() => void>;
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

  useLayoutEffect(() => {
    setSlug(account ? (intranetMallSlug(account.baseUrl) ?? "") : "");
    setUsername(account?.username ?? "");
    setPassword("");
    setShowPassword(false);
    setAutorizo(false);
  }, [account]);

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

  const slugError = slug.length > 0 && !baseUrl ? "Informe o identificador da filial, como shoppingcampogrande4." : undefined;
  const canConectar = !busy && baseUrl != null && username.trim().length > 0 && (password.trim().length > 0 || conectado) && (conectado || autorizo);
  const label = busy ? (conectado ? "Salvando…" : "Conectando…") : conectado ? "Salvar alterações" : "Conectar";
  saveRef.current = () => void conectar();

  useLayoutEffect(() => {
    onBar({ busy, canSave: canConectar, label });
  }, [busy, canConectar, label, onBar]);

  useLayoutEffect(() => () => onBar(IDLE_BAR), [onBar]);

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[13.5px] leading-relaxed text-t1">
        Informe os dados de acesso da Intranet Mall desta filial. A WDash protege esses dados e os usa somente para informar as vendas ao shopping.
      </p>
      {replacedName ? (
        <p className="text-[13px] leading-relaxed text-t1">Ao conectar, o acesso {replacedName} será substituído pelo da Intranet Mall.</p>
      ) : null}
      <FormField
        label="Identificador da filial"
        required
        error={slugError}
        hint="É o trecho do endereço depois de intranetmall.com/. Em https://app3.intranetmall.com/shoppingcampogrande4/, o identificador é shoppingcampogrande4."
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
      <FormField label="Senha" required={!conectado} hint={conectado ? "Digite uma nova senha somente se quiser alterar a atual." : undefined}>
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
  );
}
