import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Skeleton, useToast } from "@/components/ui";
import {
  INTRANET_MALL_ORIGIN,
  intranetMallBaseUrl,
  intranetMallSlug,
  shoppingAdministratorName,
  type ShoppingAdministrator as MallAdministrator,
} from "@/data/wedash/shoppingReport";
import { clearShoppingAccount, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { cn } from "@/lib/cn";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { SHOPPING_MENU_EVENT } from "@/layout/useShoppingMenu";
import { PlusIcon } from "@/pages/utility/icons";
import { GroupComModal, type ShoppingFormBar } from "@/pages/operation/GroupComModal";
import { CostCardTitle } from "./shared";

const IDLE_BAR: ShoppingFormBar = { busy: false, canSave: false, label: "Salvar acesso" };

type MallStep = "pick" | MallAdministrator | "other";

const CHOICES: { id: Exclude<MallStep, "pick" | "argo">; name: string; detail: string; logo: string | null }[] = [
  { id: "allos", name: "Intranet Mall", detail: "Informe de vendas", logo: "/intranet.png" },
  { id: "groupcom", name: "Group COM", detail: "Informe de vendas", logo: "/group-com.png" },
  { id: "other", name: "Outros", detail: "Sem integração automática com a WDash", logo: null },
];

function accessPhrase(administrator: MallAdministrator): string {
  const name = shoppingAdministratorName(administrator);
  return administrator === "groupcom" ? `do ${name}` : `da ${name}`;
}

function mallLogo(administrator: MallAdministrator): string | null {
  if (administrator === "allos") return "/intranet.png";
  if (administrator === "groupcom") return "/group-com.png";
  return null;
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

function stepTitle(step: MallStep): string {
  if (step === "pick") return "Adicionar administradora";
  if (step === "other") return "Outros";
  return shoppingAdministratorName(step);
}

/** Card da administradora no quiosque. No máximo uma. A escolha fica na modal. */
export function ShoppingAdministrator({
  storeId,
  account,
  loading,
  onAccount,
}: {
  storeId: string;
  account: ShoppingAccount | null;
  loading: boolean;
  onAccount: (account: ShoppingAccount | null) => void;
}) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<MallStep>("pick");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  function abrir(next: MallStep) {
    setStep(next);
    setOpen(true);
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
    setOpen(false);
  }

  return (
    <>
      <Card>
        <CostCardTitle title="Administradora do shopping" />
        <p className="mb-4 text-[12.5px] text-t2">Configure a administradora responsável pelo informe de vendas desta filial.</p>
        {loading ? (
          <Skeleton className="h-[62px] w-full rounded-[13px]" />
        ) : (
          <div className="flex flex-col gap-2.5">
            {account ? (
              <div className="flex flex-wrap items-center gap-3.5 rounded-[13px] border border-line bg-bg-inset px-4 py-3.5">
                <MallMark logo={mallLogo(account.administrator)} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-t0">{shoppingAdministratorName(account.administrator)}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-t2">{mallDetail(account)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => abrir(account.administrator)} disabled={removing}>
                  Editar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRemoveOpen(true)} disabled={removing}>
                  Remover
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => abrir("pick")}
                className="flex h-[42px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[13px] font-semibold text-t2 hover:border-acc hover:text-acc"
              >
                <PlusIcon size={15} />
                Adicionar administradora
              </button>
            )}
          </div>
        )}
      </Card>
      <AdministratorModal
        open={open}
        step={step}
        storeId={storeId}
        account={account}
        onStep={setStep}
        onClose={() => setOpen(false)}
        onAccount={onAccount}
      />
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

function MallMark({ logo }: { logo: string | null }) {
  return (
    <span className="flex h-[30px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-bg-2">
      {logo ? (
        <img src={logo} alt="" className="h-full w-full object-contain p-1" />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-t2" aria-hidden>
          <path d="M3 21h18" />
          <path d="M5 21V7l7-4 7 4v14" />
          <path d="M9 21v-6h6v6" />
        </svg>
      )}
    </span>
  );
}

function AdministratorModal({
  open,
  step,
  storeId,
  account,
  onStep,
  onClose,
  onAccount,
}: {
  open: boolean;
  step: MallStep;
  storeId: string;
  account: ShoppingAccount | null;
  onStep: (step: MallStep) => void;
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

  const locked = bar.busy || removing;
  const fromPicker = step !== "pick" && account?.administrator !== step;
  const formAccount = account && account.administrator === step ? account : null;
  const replaced = account && (step === "allos" || step === "groupcom") && account.administrator !== step ? accessPhrase(account.administrator) : null;

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
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={stepTitle(step)}
        footer={
          <>
            {fromPicker ? (
              <Button variant="ghost" className="mr-auto" onClick={() => onStep("pick")} disabled={locked}>
                Voltar
              </Button>
            ) : null}
            <Button variant="outline" onClick={close} disabled={locked}>
              Cancelar
            </Button>
            {step === "allos" || step === "groupcom" ? (
              <Button onClick={() => saveRef.current()} disabled={!bar.canSave}>
                {bar.label}
              </Button>
            ) : null}
            {step === "other" && account ? (
              <Button onClick={() => void remover()} disabled={locked}>
                {removing ? "Removendo…" : "Remover acesso"}
              </Button>
            ) : null}
            {step === "other" && !account ? (
              <Button
                onClick={() => {
                  show("Esta filial ficará sem informe automático de vendas.", "info");
                  onClose();
                }}
                disabled={locked}
              >
                Concluir
              </Button>
            ) : null}
          </>
        }
      >
        {step === "pick" ? (
          <div className="flex flex-col gap-2.5">
            <p className="mb-1 text-[13.5px] leading-relaxed text-t1">Selecione a administradora desta filial.</p>
            {CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => onStep(choice.id)}
                className="flex w-full items-center gap-3 rounded-[13px] border border-line bg-bg-inset px-3.5 py-3 text-left hover:border-line-2 hover:bg-bg-3"
              >
                <MallMark logo={choice.logo} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-t0">{choice.name}</span>
                  <span className="mt-0.5 block text-[12px] text-t2">{choice.detail}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {step === "other" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed text-t1">Sem integração automática com a WDash.</p>
            {account ? (
              <p className="text-[13.5px] leading-relaxed text-t1">
                O acesso atual {accessPhrase(account.administrator)} será removido. A WDash deixará de informar vendas ao shopping.
              </p>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-t1">O informe de vendas desta filial não será enviado ao shopping.</p>
            )}
          </div>
        ) : null}
        {step === "argo" ? (
          <p className="text-[13.5px] leading-relaxed text-t1">A integração com a Argo ainda não está disponível na WDash.</p>
        ) : null}
        {open && step === "allos" ? (
          <IntranetMallForm account={formAccount} replacedName={replaced} storeId={storeId} onSaved={saved} onBar={onBar} saveRef={saveRef} />
        ) : null}
        {open && step === "groupcom" ? (
          <GroupComModal account={formAccount} replacedName={replaced} storeId={storeId} onSaved={saved} onBar={onBar} saveRef={saveRef} />
        ) : null}
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
  const label = busy ? "Salvando…" : conectado ? "Salvar alterações" : "Salvar acesso";
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
        <p className="text-[13px] leading-relaxed text-t1">Ao salvar, o acesso {replacedName} será substituído pelo da Intranet Mall.</p>
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
