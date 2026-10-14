import { useEffect, useState } from "react";
import { Button, Checkbox, FormField, Input, Modal, useToast } from "@/components/ui";
import { groupComBaseUrl, groupComSlug, type GroupComUnit } from "@/data/wedash/groupCom";
import { listGroupComUnits, saveShoppingAccount, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { cn } from "@/lib/cn";
import { noAutofill, secretStyle } from "@/lib/noAutofill";

/** Modal do card Group COM. A busca das unidades não grava a senha. */
export function GroupComModal({
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [task, setTask] = useState<"list" | "save" | null>(null);
  const busy = task != null;
  const [units, setUnits] = useState<GroupComUnit[]>([]);
  const [selected, setSelected] = useState<GroupComUnit | null>(null);
  const baseUrl = groupComBaseUrl(slug);

  useEffect(() => {
    if (!open) return;
    setSlug(account ? (groupComSlug(account.baseUrl) ?? "") : "");
    setEmail(account?.username ?? "");
    setPassword("");
    setShowPassword(false);
    setAutorizo(false);
    setTask(null);
    setUnits(account?.unit ? [account.unit] : []);
    setSelected(account?.unit ?? null);
  }, [open, account]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function buscar() {
    if (!baseUrl) return;
    setTask("list");
    const result = await listGroupComUnits({ storeId, baseUrl, username: email.trim(), password });
    setTask(null);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    setUnits(result.units);
    setSelected((current) => result.units.find((unit) => unit.contractId === current?.contractId) ?? null);
  }

  async function conectar() {
    if (!baseUrl || !selected) return;
    setTask("save");
    const result = await saveShoppingAccount({
      storeId,
      administrator: "groupcom",
      baseUrl,
      username: email.trim(),
      password,
      unit: selected,
    });
    setTask(null);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    onSaved({
      storeId,
      administrator: "groupcom",
      baseUrl,
      username: email.trim(),
      lastRunAt: account?.lastRunAt ?? null,
      lastError: "",
      unit: selected,
    });
  }

  const slugError = slug.length > 0 && !baseUrl ? "Informe o identificador do portal, como treslagoasapp." : undefined;
  const canBuscar = !busy && baseUrl != null && email.trim().includes("@") && password.trim().length > 0;
  const canConectar = !busy && baseUrl != null && email.trim().includes("@") && selected != null && (password.trim().length > 0 || conectado) && (conectado || autorizo);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Group COM"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void conectar()} disabled={!canConectar}>
            {task === "save" ? "Salvando…" : conectado ? "Salvar alterações" : "Salvar acesso"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[13.5px] leading-relaxed text-t1">
          Informe os dados de acesso do Group COM e escolha a unidade desta filial. A WDash protege esses dados e os usa somente para informar as vendas ao shopping.
        </p>
        {replacedName ? (
          <p className="text-[13px] leading-relaxed text-t1">Ao salvar, o acesso da {replacedName} será substituído pelo do Group COM.</p>
        ) : null}
        <FormField
          label="Identificador do portal"
          required
          error={slugError}
          hint="É o trecho do endereço antes de .com21.com.br. Em https://treslagoasapp.com21.com.br/, o identificador é treslagoasapp."
        >
          <div className={cn("flex flex-col overflow-hidden rounded-[var(--radius-vela-md)] border bg-bg-inset focus-within:border-acc sm:h-[42px] sm:flex-row", slugError ? "border-bad" : "border-line")}>
            <span className="flex shrink-0 items-center border-b border-line bg-bg-3 px-3 py-2 text-[12px] text-t2 sm:border-b-0 sm:border-r sm:py-0">https://</span>
            <input
              value={slug}
              onChange={(event) => {
                setSlug(slugField(event.target.value));
                setUnits([]);
                setSelected(null);
              }}
              placeholder="treslagoasapp"
              disabled={busy}
              className="h-[42px] min-w-0 flex-1 bg-transparent px-3 text-[13px] text-t0 outline-none placeholder:text-t2"
              {...noAutofill}
            />
            <span className="flex shrink-0 items-center border-t border-line bg-bg-3 px-3 py-2 text-[12px] text-t2 sm:border-l sm:border-t-0 sm:py-0">.com21.com.br</span>
          </div>
        </FormField>
        <FormField label="E-mail" required>
          <Input value={email} onChange={(event) => setEmail(event.target.value.trim())} disabled={busy} inputMode="email" {...noAutofill} />
        </FormField>
        <FormField label="Senha" required={!conectado} hint={conectado ? "Digite a senha para buscar as unidades ou para alterar a senha cadastrada." : undefined}>
          <div className="relative">
            <Input
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-t0">Unidade</p>
            <Button size="sm" variant="outline" onClick={() => void buscar()} disabled={!canBuscar}>
              {task === "list" ? "Buscando…" : "Buscar unidades"}
            </Button>
          </div>
          {units.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-t2">Busque as unidades e selecione a correspondente a esta filial.</p>
          ) : (
            units.map((unit) => {
              const active = selected?.contractId === unit.contractId;
              return (
                <button
                  key={unit.contractId}
                  type="button"
                  onClick={() => setSelected(unit)}
                  disabled={busy}
                  className={cn("rounded-[var(--radius-vela-md)] border px-3 py-2 text-left", active ? "border-acc bg-acc-soft" : "border-line hover:bg-bg-3")}
                >
                  <span className="block text-[13px] font-bold text-t0">{unit.mall}</span>
                  <span className="block text-[12px] text-t2">{[unit.floor, unit.code].filter(Boolean).join(" · ")}</span>
                </button>
              );
            })
          )}
        </div>
        {!conectado ? (
          <Checkbox
            label="Autorizo a WDash a usar este acesso para informar as vendas desta filial ao shopping."
            checked={autorizo}
            onChange={(event) => setAutorizo(event.target.checked)}
            disabled={busy}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function slugField(value: string): string {
  const parsed = groupComSlug(value);
  if (parsed && (value.includes("://") || value.toLowerCase().includes("com21.com.br"))) return parsed;
  return value.toLowerCase().replace(/\s/g, "").replace(/^\/+|\/+$/g, "");
}
