import { useEffect, useState } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, useToast } from "@/components/ui";
import { INTRANET_MALL_ORIGIN, intranetMallBaseUrl, intranetMallSlug, shoppingAdministratorName } from "@/data/wedash/shoppingReport";
import { saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { cn } from "@/lib/cn";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { SHOPPING_MENU_EVENT } from "@/layout/useShoppingMenu";
import { GroupComModal } from "@/pages/operation/GroupComModal";

/** Card da administradora escolhida na Filial. Salvar outra substitui a atual. */
export function ShoppingIntegration({
  storeId,
  choice,
  account,
  onAccount,
}: {
  storeId: string;
  choice: "allos" | "groupcom";
  account: ShoppingAccount | null;
  onAccount: (account: ShoppingAccount) => void;
}) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const active = account?.administrator === choice ? account : null;
  const replacedName = account != null && account.administrator !== choice ? shoppingAdministratorName(account.administrator) : null;
  const group = choice === "groupcom";

  return (
    <>
      <ShoppingCard
        logo={group ? "/group-com.png" : "/intranet.png"}
        name={group ? "Group COM" : "Intranet Mall"}
        detail={group && active?.unit ? [active.unit.floor, active.unit.code].filter(Boolean).join(" / ") : "Informe de vendas"}
        connected={active != null}
        onOpen={() => setOpen(true)}
      />
      {group ? (
        <GroupComModal
          open={open}
          account={active}
          replacedName={replacedName}
          storeId={storeId}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            onAccount(next);
            window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
            show(active ? "Alterações salvas." : "Acesso do Group COM configurado.", "success");
            setOpen(false);
          }}
        />
      ) : (
        <IntranetMallModal
          open={open}
          account={active}
          replacedName={replacedName}
          storeId={storeId}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            onAccount(next);
            window.dispatchEvent(new Event(SHOPPING_MENU_EVENT));
            show(active ? "Alterações salvas." : "Acesso da Intranet Mall configurado.", "success");
            setOpen(false);
          }}
        />
      )}
    </>
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
  replacedName,
  storeId,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: ShoppingAccount | null;
  replacedName: string | null;
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
        {replacedName ? (
          <p className="text-[13px] leading-relaxed text-t1">Salvar aqui substitui o acesso da {replacedName} desta filial. Cada filial integra com uma administradora.</p>
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
