import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Select, useToast } from "@/components/ui";
import { ConnectionCard, ConnectionSkeleton, PickerRow } from "@/components/wedash/ConnectionList";
import {
  INTRANET_MALL_ORIGIN,
  intranetMallBaseUrl,
  intranetMallSlug,
  shoppingAdministratorName,
} from "@/data/wedash/shoppingReport";
import { clearShoppingAccount, fetchShoppingAccounts, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import type { Store } from "@/data/wedash/stores";
import { cn } from "@/lib/cn";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { isOwner } from "@/layout/nav-wedash";
import { SHOPPING_MENU_EVENT } from "@/layout/useShoppingMenu";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { GroupComModal, type ShoppingFormBar } from "@/pages/operation/GroupComModal";
import { SectionHeader, useScopedStores } from "./shared";

const IDLE_BAR: ShoppingFormBar = { busy: false, canSave: false, label: "Conectar" };

type MallStep = "allos" | "groupcom";

const PROVIDERS: { id: MallStep; name: string; logo: string }[] = [
  { id: "allos", name: "Intranet Mall", logo: "/intranet.png" },
  { id: "groupcom", name: "Group COM", logo: "/group-com.png" },
];

function mallDetail(account: ShoppingAccount): string {
  if (account.administrator === "groupcom") {
    const line = account.unit ? [account.unit.mall, account.unit.floor, account.unit.code].filter(Boolean).join(" · ") : "";
    return line || "Informe de vendas";
  }
  if (account.administrator === "argo") return "Integração ainda não disponível";
  const slug = intranetMallSlug(account.baseUrl);
  return slug ? `Informe de vendas · ${slug}` : "Informe de vendas";
}

function branchName(store: Store): string {
  return store.tradeName || store.name;
}

/** Integrações > Administradora. Uma administradora por filial de shopping. */
export function ShoppingSettingsPage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const showSkeleton = useMinSkeleton(storesLoading);
  const shoppingStores = storeRows.filter((store) => store.pointType === "SHOPPING");
  const shoppingKey = shoppingStores.map((store) => store.id).join("|");
  const many = shoppingStores.length > 1;
  const [accounts, setAccounts] = useState<ShoppingAccount[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [open, setOpen] = useState<MallStep | null>(null);
  const [pending, setPending] = useState<ShoppingAccount | null>(null);
  const [removing, setRemoving] = useState(false);
  const canEdit = isOwner(session.role);
  const ready = !storesLoading && loadedKey === shoppingKey;

  useEffect(() => {
    if (storesLoading) return;
    if (shoppingStores.length === 0) {
      setAccounts([]);
      setLoadedKey(shoppingKey);
      return;
    }
    let cancel = false;
    void fetchShoppingAccounts(session.tenantId, shoppingStores.map((store) => store.id))
      .then((list) => {
        if (cancel) return;
        setAccounts(list);
        setLoadedKey(shoppingKey);
      })
      .catch(() => {
        if (cancel) return;
        setAccounts([]);
        setLoadedKey(shoppingKey);
        show("Não foi possível carregar a administradora destas filiais. Tente novamente.", "danger");
      });
    return () => {
      cancel = true;
    };
    // show do toast muda de identidade; a carga segue as filiais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storesLoading, session.tenantId, shoppingKey]);

  const streetOnly = storeRows.length > 0 && shoppingStores.length === 0;
  const scopeIds = new Set(shoppingStores.map((store) => store.id));
  const rows = accounts
    .filter((account) => scopeIds.has(account.storeId))
    .sort((a, b) => {
      const left = shoppingStores.find((store) => store.id === a.storeId);
      const right = shoppingStores.find((store) => store.id === b.storeId);
      return (left ? branchName(left) : "").localeCompare(right ? branchName(right) : "", "pt-BR");
    });
  const taken = new Set(rows.map((account) => account.storeId));
  const freeStores = shoppingStores.filter((store) => !taken.has(store.id));
  const pendingStore = pending ? shoppingStores.find((store) => store.id === pending.storeId) : null;
  const pendingName = pending ? shoppingAdministratorName(pending.administrator) : "";

  function remember(next: ShoppingAccount | null, storeId: string) {
    setAccounts((list) => {
      const rest = list.filter((account) => account.storeId !== storeId);
      return next ? [...rest, next] : rest;
    });
  }

  async function disconnect() {
    if (!pending) return;
    setRemoving(true);
    const result = await clearShoppingAccount(pending.storeId);
    setRemoving(false);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    remember(null, pending.storeId);
    window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
    show("Administradora desconectada.", "success");
    setPending(null);
  }

  return (
    <div>
      <SectionHeader
        section="Integrações"
        title="Administradora"
        subtitle={many ? "Conecte a administradora de cada filial para informar as vendas ao shopping." : "Conecte a administradora desta filial para informar as vendas ao shopping."}
      />
      {showSkeleton || !ready ? (
        <ConnectionSkeleton label="Carregando administradora…" />
      ) : storeRows.length === 0 ? (
        <Card className="mt-6 flex min-h-[280px] flex-col">
          <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
        </Card>
      ) : streetOnly ? (
        <Card className="mt-6 flex min-h-[280px] flex-col">
          <EmptyBlock
            icon="🏬"
            title="Administradora indisponível"
            description="Esta configuração está disponível apenas para filiais do tipo Quiosque em shopping."
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="mt-6 flex min-h-[280px] flex-col">
          <EmptyBlock
            icon="🏬"
            title="Nenhuma administradora conectada"
            description={many ? "Conecte a administradora responsável pelo informe de vendas das filiais selecionadas." : "Conecte a administradora responsável pelo informe de vendas desta filial."}
            action={
              <Button size="sm" onClick={() => setPicker(true)} disabled={!canEdit}>
                Conectar administradora
              </Button>
            }
          />
        </Card>
      ) : (
        <ConnectionCard
          title="Administradora"
          hint={many ? "Cada filial usa uma administradora. Desconecte para trocar." : `Esta filial já está conectada à ${shoppingAdministratorName(rows[0]!.administrator)}. Desconecte para trocar.`}
          action={
            freeStores.length > 0 ? (
              <Button size="sm" onClick={() => setPicker(true)} disabled={!canEdit}>
                Conectar administradora
              </Button>
            ) : undefined
          }
          rows={rows.map((account) => {
            const store = shoppingStores.find((item) => item.id === account.storeId);
            const provider = PROVIDERS.find((item) => item.id === account.administrator);
            const connectedName = shoppingAdministratorName(account.administrator);
            return {
              key: account.storeId,
              name: connectedName,
              store: many && store ? branchName(store) : undefined,
              detail: mallDetail(account),
              status: account.administrator === "argo" ? undefined : "Conectada",
              mark: provider ? (
                <img src={provider.logo} alt="" className="h-full w-full object-contain p-1.5" />
              ) : (
                <span className="text-[11px] font-bold text-t0">{connectedName}</span>
              ),
              onDisconnect: () => setPending(account),
            };
          })}
        />
      )}
      <Modal
        open={picker}
        onClose={() => setPicker(false)}
        title="Conectar administradora"
        footer={
          <Button variant="outline" onClick={() => setPicker(false)}>
            Cancelar
          </Button>
        }
      >
        <p className="mb-3 text-[13.5px] leading-relaxed text-t1">{freeStores.length > 1 ? "Escolha a administradora. Depois, escolha a filial." : "Escolha a administradora desta filial."}</p>
        <div className="flex flex-col gap-2.5">
          {PROVIDERS.map((item) => (
            <PickerRow
              key={item.id}
              name={item.name}
              detail="Informe de vendas"
              mark={<img src={item.logo} alt="" className="h-full w-full object-contain p-1.5" />}
              onClick={() => {
                setPicker(false);
                setOpen(item.id);
              }}
            />
          ))}
        </div>
      </Modal>
      <Modal
        open={pending != null}
        onClose={() => {
          if (!removing) setPending(null);
        }}
        title={pending ? `Desconectar ${pendingName}?` : "Desconectar?"}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)} disabled={removing}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void disconnect()} disabled={removing}>
              {removing ? "Desconectando…" : "Desconectar"}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-t1">
          A WDash deixará de informar as vendas {many && pendingStore ? `de ${branchName(pendingStore)}` : "desta filial"} ao shopping. Os valores já informados serão mantidos.
        </p>
      </Modal>
      {open ? (
        <AdministratorModal
          open
          step={open}
          stores={freeStores}
          onClose={() => setOpen(null)}
          onAccount={remember}
        />
      ) : null}
    </div>
  );
}

function AdministratorModal({
  open,
  step,
  stores,
  onClose,
  onAccount,
}: {
  open: boolean;
  step: MallStep;
  stores: Store[];
  onClose: () => void;
  onAccount: (account: ShoppingAccount | null, storeId: string) => void;
}) {
  const { show } = useToast();
  const saveRef = useRef<() => void>(() => {});
  const [bar, setBar] = useState<ShoppingFormBar>(IDLE_BAR);
  const [storeId, setStoreId] = useState("");
  const storeKey = stores.map((store) => store.id).join("|");
  const onBar = useCallback((next: ShoppingFormBar) => {
    setBar((current) => (current.busy === next.busy && current.canSave === next.canSave && current.label === next.label ? current : next));
  }, []);

  useEffect(() => {
    if (!open) return;
    const ids = storeKey.split("|").filter(Boolean);
    if (ids.length <= 1) setStoreId(ids[0] ?? "");
    else setStoreId((current) => (ids.includes(current) ? current : ""));
  }, [open, storeKey]);

  const locked = bar.busy;

  function close() {
    if (locked) return;
    onClose();
  }

  function saved(next: ShoppingAccount) {
    onAccount(next, next.storeId);
    window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
    const created = next.administrator === "groupcom" ? "Acesso do Group COM configurado." : "Acesso da Intranet Mall configurado.";
    show(created, "success");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={shoppingAdministratorName(step)}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={locked}>
            Cancelar
          </Button>
          <Button onClick={() => saveRef.current()} disabled={!bar.canSave}>
            {bar.label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {stores.length > 1 ? (
          <FormField label="Filial" required>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={locked} {...noAutofill}>
              <option value="" disabled>
                Selecione a filial
              </option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {branchName(store)}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        {open && storeId && step === "allos" ? (
          <IntranetMallForm key={storeId} account={null} replacedName={null} storeId={storeId} onSaved={saved} onBar={onBar} saveRef={saveRef} />
        ) : null}
        {open && storeId && step === "groupcom" ? (
          <GroupComModal key={storeId} account={null} replacedName={null} storeId={storeId} onSaved={saved} onBar={onBar} saveRef={saveRef} />
        ) : null}
      </div>
    </Modal>
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

  const slugError = slug.length > 0 && !baseUrl ? "Informe o identificador da filial, como shoppingexemplo." : undefined;
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
        <p className="text-[13.5px] leading-relaxed text-t1">Ao conectar, o acesso {replacedName} será substituído pelo da Intranet Mall.</p>
      ) : null}
      <FormField
        label="Identificador da filial"
        required
        error={slugError}
        hint="É o trecho do endereço depois de intranetmall.com/. Em app3.intranetmall.com/shoppingexemplo/, o identificador é shoppingexemplo."
      >
        <div className={cn("flex flex-col overflow-hidden rounded-[var(--radius-vela-md)] border bg-bg-inset focus-within:border-acc sm:h-[42px] sm:flex-row", slugError ? "border-bad" : "border-line")}>
          <span className="flex shrink-0 items-center border-b border-line bg-bg-3 px-3 py-2 text-[12px] text-t2 sm:border-b-0 sm:border-r sm:py-0">
            {INTRANET_MALL_ORIGIN.replace("https://", "")}/
          </span>
          <input
            value={slug}
            onChange={(e) => setSlug(slugFieldValue(e.target.value))}
            placeholder="shoppingexemplo"
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
