import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Select, Skeleton, useToast } from "@/components/ui";
import {
  disconnectCieloLink,
  disconnectStoneLink,
  fetchCieloAccount,
  fetchCieloLinks,
  fetchStoneLinks,
  requestMonthClose,
  saveCieloLink,
  saveStoneLink,
  type CieloAccount,
  type CieloLink,
  type StoneLink,
} from "@/data/wedash/cashCloseRepo";
import type { Store } from "@/data/wedash/stores";
import { isOwner } from "@/layout/nav-wedash";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { useScope } from "@/pages/dashboard/useScope";

/** Configurações > Adquirentes. A chave é da loja, no mesmo desenho do Millennium. */
export function AcquirersPage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showSkeleton = useMinSkeleton(storesLoading);
  const [links, setLinks] = useState<StoneLink[]>([]);
  const [cieloLinks, setCieloLinks] = useState<CieloLink[]>([]);
  const [cieloAccount, setCieloAccount] = useState<CieloAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [cieloOpen, setCieloOpen] = useState(false);
  const canEdit = isOwner(session.role);

  const reload = useCallback(async () => {
    const ids = storeRows.map((l) => l.id);
    const [stone, cielo, access] = await Promise.all([
      fetchStoneLinks(session.tenantId, ids).then(
        (rows) => ({ rows, ok: true as const }),
        () => ({ rows: [] as StoneLink[], ok: false as const }),
      ),
      fetchCieloLinks(session.tenantId, ids).then(
        (rows) => ({ rows, ok: true as const }),
        () => ({ rows: [] as CieloLink[], ok: false as const }),
      ),
      fetchCieloAccount(session.tenantId).then(
        (account) => ({ account, ok: true as const }),
        () => ({ account: null, ok: false as const }),
      ),
    ]);
    if (stone.ok) setLinks(stone.rows);
    if (cielo.ok) setCieloLinks(cielo.rows);
    if (access.ok) setCieloAccount(access.account);
    if (!stone.ok || !cielo.ok || !access.ok) show("Não foi possível carregar as adquirentes. Tente novamente.", "danger");
    setLoading(false);
    // show do toast muda de identidade; a carga segue a loja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tenantId, storeRows]);

  useEffect(() => {
    if (storesLoading) return;
    void reload();
  }, [storesLoading, reload]);

  const stoneStatus = linkStatus(links.length, storeRows.length);
  const cieloStatus = linkStatus(cieloLinks.length, storeRows.length);

  return (
    <div>
      <SectionHeader
        section="Configurações"
        title="Adquirentes"
        subtitle="Conecte as adquirentes desta filial para buscar os fechamentos de cartão e Pix na WDash."
      />
      {escolher ? (
        <div className="mt-6 max-w-[720px]">
          <SelectStoreCard />
        </div>
      ) : (
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {showSkeleton || (loading && links.length === 0 && cieloLinks.length === 0 && storeRows.length > 0) ? (
          <>
            <AcquirerSkeleton />
            <AcquirerSkeleton />
          </>
        ) : (
          <>
            <AcquirerCard
              name="Stone"
              mark={<img src="/stone.png" alt="Stone" className="h-full w-full object-contain p-1.5" />}
              status={stoneStatus}
              count={links.length}
              total={storeRows.length}
              canEdit={canEdit && storeRows.length > 0}
              onOpen={() => setOpen(true)}
            />
            <AcquirerCard
              name="Cielo"
              mark={<span className="text-[13px] font-bold tracking-tight text-t0">Cielo</span>}
              status={cieloStatus}
              count={cieloLinks.length}
              total={storeRows.length}
              canEdit={canEdit && storeRows.length > 0}
              onOpen={() => setCieloOpen(true)}
            />
          </>
      )}
      </div>
      )}
      <StoneModal
        open={open}
        storeRows={storeRows}
        links={links}
        cieloStoreIds={cieloLinks.map((link) => link.storeId)}
        onClose={() => setOpen(false)}
        onSaved={async (storeId) => {
          await reload();
          const order = await requestMonthClose([storeId]);
          if (!order.ok) show(order.message, "danger");
          else show("Stone conectada. Buscando os fechamentos deste mês.", "success");
          setOpen(false);
        }}
        onDisconnected={async () => {
          await reload();
          show("Stone desconectada.", "success");
        }}
      />
      <CieloModal
        open={cieloOpen}
        storeRows={storeRows}
        links={cieloLinks}
        account={cieloAccount}
        stoneStoreIds={links.map((link) => link.storeId)}
        onClose={() => setCieloOpen(false)}
        onSaved={async (storeId) => {
          await reload();
          const order = await requestMonthClose([storeId]);
          if (!order.ok) show(order.message, "danger");
          else show("Cielo conectada. Buscando os fechamentos deste mês.", "success");
          setCieloOpen(false);
        }}
        onDisconnected={async () => {
          await reload();
          show("Cielo desconectada.", "success");
        }}
      />
    </div>
  );
}

function linkStatus(connected: number, total: number): { label: string; tone: string; dot: string } {
  if (connected === 0 || total === 0) return { label: "Desconectado", tone: "text-t2", dot: "bg-t2" };
  if (connected === total) return { label: "Conectado", tone: "text-ok", dot: "bg-ok" };
  return { label: `Parcial · ${connected} de ${total} filiais`, tone: "text-warn", dot: "bg-warn" };
}

function AcquirerSkeleton() {
  return (
    <Card>
      <div className="mb-3.5 flex items-center gap-3" aria-busy="true" aria-label="Carregando adquirentes…">
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

function AcquirerCard({
  name,
  mark,
  status,
  count,
  canEdit,
  onOpen,
}: {
  name: string;
  mark: ReactNode;
  status: { label: string; tone: string; dot: string };
  count: number;
  total: number;
  canEdit: boolean;
  onOpen: () => void;
}) {
  return (
    <Card>
      <div className="mb-3.5 flex items-center gap-3">
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-bg-inset">
          {mark}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold text-t0">{name}</p>
          <p className="mt-0.5 text-[11.5px] text-t2">Cartão e Pix</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className={`flex items-center gap-1.5 text-xs font-bold ${status.tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        <Button size="sm" onClick={onOpen} disabled={!canEdit}>
          {count > 0 ? "Gerenciar" : "Conectar"}
        </Button>
      </div>
    </Card>
  );
}

function StoneModal({
  open,
  storeRows,
  links,
  cieloStoreIds,
  onClose,
  onSaved,
  onDisconnected,
}: {
  open: boolean;
  storeRows: Store[];
  links: StoneLink[];
  cieloStoreIds: string[];
  onClose: () => void;
  onSaved: (storeId: string) => Promise<void>;
  onDisconnected: () => Promise<void>;
}) {
  const { show } = useToast();
  const [storeId, setStoreId] = useState("");
  const link = links.find((l) => l.storeId === storeId);
  const conectado = Boolean(link);
  const [stoneCode, setStoneCode] = useState("");
  const [secret, setSecret] = useState("");
  const [showRowKey, setShowRowKey] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (storeRows.length <= 1) setStoreId(storeRows[0]?.id ?? "");
    else if (!storeRows.some((l) => l.id === storeId)) setStoreId("");
    setAutorizo(false);
  }, [open, storeRows, storeId]);

  useEffect(() => {
    setStoneCode(link?.stoneCode ?? "");
    setSecret("");
    setShowRowKey(false);
    setAutorizo(false);
  }, [link?.stoneCode, storeId]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
    if (cieloStoreIds.includes(storeId)) {
      show("Esta filial já usa a Cielo. Desconecte a Cielo antes de conectar a Stone.", "danger");
      return;
    }
    setBusy(true);
    const r = await saveStoneLink({ storeId, stoneCode, secret, covers: "all" });
    setBusy(false);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    setSecret("");
    await onSaved(storeId);
  }

  async function desconectar() {
    setBusy(true);
    const r = await disconnectStoneLink(storeId);
    setBusy(false);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    await onDisconnected();
  }

  const travado = conectado || busy;
  const canConectar =
    !conectado && autorizo && storeId.length > 0 && stoneCode.trim().length >= 5 && secret.trim().length > 0 && !busy;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Stone"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          {conectado ? (
            <Button variant="danger" onClick={() => void desconectar()} disabled={busy}>
              {busy ? "Desconectando…" : "Desconectar"}
            </Button>
          ) : (
            <Button onClick={() => void conectar()} disabled={!canConectar}>
              {busy ? "Conectando…" : "Conectar"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {conectado ? (
          <p className="text-[13.5px] leading-relaxed text-t1">
            A WDash está conectada à Stone desta loja. Os fechamentos de cartão e Pix são buscados automaticamente
            enquanto a conexão estiver ativa.
          </p>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Informe o Stone Code e a chave secreta desta loja. A WDash protege esses dados e os usa somente para acessar
              as informações da Stone.
            </p>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Ao conectar, buscamos os fechamentos disponíveis deste mês, do dia 1 até ontem.
            </p>
          </>
        )}
        {storeRows.length > 1 && (
          <FormField label="Filial" required>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy} {...noAutofill}>
              <option value="" disabled>
                Selecione a loja
              </option>
              {storeRows.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.tradeName}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Stone Code" required>
          <Input
            value={stoneCode}
            onChange={(e) => setStoneCode(e.target.value)}
            placeholder="Digite o Stone Code"
            inputMode="numeric"
            disabled={travado}
            {...noAutofill}
          />
        </FormField>
        <FormField label="Chave secreta" required={!conectado}>
          <div className="relative">
            <Input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={conectado ? "Chave já cadastrada" : "Digite a chave secreta"}
              style={secretStyle(showRowKey && !conectado)}
              disabled={travado}
              className={conectado ? undefined : "pr-12"}
              {...noAutofill}
            />
            {!conectado && (
              <button
                type="button"
                onClick={() => setShowRowKey((m) => !m)}
                aria-label={showRowKey ? "Ocultar chave" : "Mostrar chave"}
                disabled={busy}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
              >
                {showRowKey ? (
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
            )}
          </div>
        </FormField>
        {conectado ? (
          <div className="space-y-3 text-[12.5px] leading-relaxed">
            <div>
              <p className="font-semibold text-t0">Alterar dados de acesso</p>
              <p className="mt-0.5 text-t2">
                Para trocar o Stone Code ou a chave secreta, desconecte e conecte novamente com os novos dados.
              </p>
            </div>
            <div>
              <p className="font-semibold text-t0">Desconexão</p>
              <p className="mt-0.5 text-t2">
                Ao desconectar, a WDash deixa de buscar automaticamente os fechamentos de cartão e Pix desta loja.
              </p>
            </div>
          </div>
        ) : (
          <Checkbox
            label="Autorizo a WDash a usar este acesso para buscar os fechamentos de cartão e Pix."
            checked={autorizo}
            onChange={(e) => setAutorizo(e.target.checked)}
            disabled={busy}
          />
        )}
      </div>
    </Modal>
  );
}

function CieloModal({
  open,
  storeRows,
  links,
  account,
  stoneStoreIds,
  onClose,
  onSaved,
  onDisconnected,
}: {
  open: boolean;
  storeRows: Store[];
  links: CieloLink[];
  account: CieloAccount | null;
  stoneStoreIds: string[];
  onClose: () => void;
  onSaved: (storeId: string) => Promise<void>;
  onDisconnected: () => Promise<void>;
}) {
  const { show } = useToast();
  const [storeId, setStoreId] = useState("");
  const link = links.find((l) => l.storeId === storeId);
  const conectado = Boolean(link);
  const hasAccount = Boolean(account);
  const [code, setCode] = useState("");
  const [merchantCode, setMerchantCode] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hmac, setHmac] = useState("");
  const [cert, setCert] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (storeRows.length <= 1) setStoreId(storeRows[0]?.id ?? "");
    else if (!storeRows.some((l) => l.id === storeId)) setStoreId("");
    setAutorizo(false);
  }, [open, storeRows, storeId]);

  useEffect(() => {
    setCode(link?.establishmentCode ?? "");
    setMerchantCode(account?.merchantCode ?? "");
    setClientId(account?.clientId ?? "");
    setClientSecret("");
    setHmac("");
    setCert("");
    setPrivateKey("");
    setShowSecret(false);
    setAutorizo(false);
  }, [link?.establishmentCode, account?.merchantCode, account?.clientId, storeId]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
    if (stoneStoreIds.includes(storeId)) {
      show("Esta filial já usa a Stone. Desconecte a Stone antes de conectar a Cielo.", "danger");
      return;
    }
    setBusy(true);
    const r = await saveCieloLink({
      storeId,
      establishmentCode: code,
      merchantCode,
      clientId,
      clientSecret,
      hmac,
      cert,
      privateKey,
    });
    setBusy(false);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    setClientSecret("");
    setHmac("");
    setCert("");
    setPrivateKey("");
    await onSaved(storeId);
  }

  async function desconectar() {
    setBusy(true);
    const r = await disconnectCieloLink(storeId);
    setBusy(false);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    await onDisconnected();
  }

  const travado = conectado || busy;
  const secretsOk = hasAccount || (clientSecret.trim().length > 0 && hmac.trim().length > 0 && cert.length > 0 && privateKey.length > 0);
  const canConectar =
    !conectado &&
    autorizo &&
    storeId.length > 0 &&
    code.replace(/\D/g, "").length >= 4 &&
    merchantCode.replace(/\D/g, "").length >= 4 &&
    clientId.trim().length >= 8 &&
    secretsOk &&
    !busy;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Cielo"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          {conectado ? (
            <Button variant="danger" onClick={() => void desconectar()} disabled={busy}>
              {busy ? "Desconectando…" : "Desconectar"}
            </Button>
          ) : (
            <Button onClick={() => void conectar()} disabled={!canConectar}>
              {busy ? "Conectando…" : "Conectar"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {conectado ? (
          <p className="text-[13.5px] leading-relaxed text-t1">
            A WDash está conectada à Cielo desta loja. Os fechamentos de cartão e Pix são buscados automaticamente
            enquanto a conexão estiver ativa.
          </p>
        ) : hasAccount ? (
          <>
            <p className="text-[13.5px] leading-relaxed text-t1">
              O acesso Cielo desta empresa já está cadastrado. Informe o estabelecimento desta filial.
            </p>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Ao conectar, buscamos os fechamentos disponíveis deste mês, do dia 1 até ontem.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Informe o acesso Cielo desta empresa e o estabelecimento desta filial. O certificado e as chaves ficam
              protegidos e servem para todas as filiais.
            </p>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Ao conectar, buscamos os fechamentos disponíveis deste mês, do dia 1 até ontem.
            </p>
          </>
        )}
        {storeRows.length > 1 && (
          <FormField label="Filial" required>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy} {...noAutofill}>
              <option value="" disabled>
                Selecione a loja
              </option>
              {storeRows.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.tradeName}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Matriz" required>
          <Input
            value={merchantCode}
            onChange={(e) => setMerchantCode(e.target.value)}
            placeholder="Número da matriz"
            inputMode="numeric"
            disabled={travado || hasAccount}
            {...noAutofill}
          />
        </FormField>
        <FormField label="Client ID" required>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID da aplicação"
            disabled={travado || hasAccount}
            {...noAutofill}
          />
        </FormField>
        {!conectado && (
          <>
            <FormField label="Client secret" required={!hasAccount}>
              <Input
                type="text"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasAccount ? "Já cadastrado" : "Client secret"}
                style={secretStyle(showSecret)}
                disabled={busy}
                className="pr-12"
                {...noAutofill}
              />
            </FormField>
            <FormField label="Chave" required={!hasAccount}>
              <div className="relative">
                <Input
                  type="text"
                  value={hmac}
                  onChange={(e) => setHmac(e.target.value)}
                  placeholder={hasAccount ? "Já cadastrada" : "Chave da aplicação"}
                  style={secretStyle(showSecret)}
                  disabled={busy}
                  className="pr-12"
                  {...noAutofill}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((m) => !m)}
                  aria-label={showSecret ? "Ocultar chaves" : "Mostrar chaves"}
                  disabled={busy}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
                >
                  {showSecret ? "ocultar" : "ver"}
                </button>
              </div>
            </FormField>
            <CieloFile label="Certificado" required={!hasAccount} fileName={cert ? "arquivo selecionado" : ""} disabled={busy} onPick={setCert} />
            <CieloFile label="Chave privada" required={!hasAccount} fileName={privateKey ? "arquivo selecionado" : ""} disabled={busy} onPick={setPrivateKey} />
          </>
        )}
        <FormField label="Estabelecimento" required>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Número do estabelecimento"
            inputMode="numeric"
            disabled={travado}
            {...noAutofill}
          />
        </FormField>
        {conectado ? (
          <div className="space-y-3 text-[12.5px] leading-relaxed">
            <div>
              <p className="font-semibold text-t0">Alterar o estabelecimento</p>
              <p className="mt-0.5 text-t2">Para trocar o número, desconecte e conecte novamente.</p>
            </div>
            <div>
              <p className="font-semibold text-t0">Desconexão</p>
              <p className="mt-0.5 text-t2">
                Ao desconectar, a WDash deixa de buscar automaticamente os fechamentos de cartão e Pix desta loja. O
                acesso da empresa permanece para as outras filiais.
              </p>
            </div>
          </div>
        ) : (
          <Checkbox
            label="Autorizo a WDash a buscar os fechamentos de cartão e Pix desta filial na Cielo."
            checked={autorizo}
            onChange={(e) => setAutorizo(e.target.checked)}
            disabled={busy}
          />
        )}
      </div>
    </Modal>
  );
}

function CieloFile({
  label,
  required,
  fileName,
  disabled,
  onPick,
}: {
  label: string;
  required: boolean;
  fileName: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <FormField label={label} required={required}>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-vela-sm)] border border-line bg-bg px-3 py-2 text-[13px] text-t1">
        <span className="truncate">{fileName || (required ? "Escolher arquivo" : "Já cadastrado")}</span>
        <input
          type="file"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void readCredentialFile(file).then(onPick);
          }}
        />
      </label>
    </FormField>
  );
}

async function readCredentialFile(file: File): Promise<string> {
  const text = await file.text();
  if (text.includes("BEGIN")) return text;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw);
}
