import { useCallback, useEffect, useState } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Select, useToast } from "@/components/ui";
import { ConnectionCard, ConnectionSkeleton, PickerRow } from "@/components/wedash/ConnectionList";
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
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { useScope } from "@/pages/dashboard/useScope";

type AcquirerKind = "stone" | "cielo";

type ActiveAcquirer = {
  kind: AcquirerKind;
  storeId: string;
  name: string;
  detail: string;
};

/** Integrações > Adquirentes. Uma adquirente por filial, no formato da lista de API Keys. */
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
  const [picker, setPicker] = useState(false);
  const [connectKind, setConnectKind] = useState<AcquirerKind | null>(null);
  const [pending, setPending] = useState<ActiveAcquirer | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
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

  const rows: ActiveAcquirer[] = [
    ...links.map((link) => ({
      kind: "stone" as const,
      storeId: link.storeId,
      name: "Stone",
      detail: `Stone Code ${link.stoneCode}`,
    })),
    ...cieloLinks.map((link) => ({
      kind: "cielo" as const,
      storeId: link.storeId,
      name: "Cielo",
      detail: `Estabelecimento ${link.establishmentCode}`,
    })),
  ];
  const hint =
    rows.length === 1
      ? `Esta filial já está conectada à ${rows[0]!.name}. Desconecte para trocar.`
      : "Desconecte a adquirente atual para conectar outra.";

  async function disconnect() {
    if (!pending) return;
    setDisconnecting(true);
    const result = pending.kind === "stone" ? await disconnectStoneLink(pending.storeId) : await disconnectCieloLink(pending.storeId);
    setDisconnecting(false);
    if (!result.ok) {
      show(result.message, "danger");
      return;
    }
    await reload();
    show(pending.kind === "stone" ? "Stone desconectada." : "Cielo desconectada.", "success");
    setPending(null);
  }

  return (
    <div>
      <SectionHeader
        section="Integrações"
        title="Adquirentes"
        subtitle="Conecte a adquirente desta filial para buscar fechamentos de cartão e Pix."
      />
      {escolher ? (
        <div className="mt-6 max-w-[720px]">
          <SelectStoreCard />
        </div>
      ) : showSkeleton || (loading && rows.length === 0 && storeRows.length > 0) ? (
        <ConnectionSkeleton label="Carregando adquirentes…" />
      ) : storeRows.length === 0 ? (
        <Card className="mt-6">
          <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="mt-6 flex min-h-[280px] flex-col">
          <EmptyBlock
            icon="💳"
            title="Nenhuma adquirente conectada"
            description="Conecte uma adquirente para buscar os fechamentos de cartão e Pix desta filial."
            action={
              <Button size="sm" onClick={() => setPicker(true)} disabled={!canEdit || storeRows.length === 0}>
                Conectar adquirente
              </Button>
            }
          />
        </Card>
      ) : (
        <ConnectionCard
          title="Adquirente"
          hint={hint}
          rows={rows.map((row) => ({
            key: `${row.kind}-${row.storeId}`,
            name: row.name,
            detail: row.detail,
            status: "Conectada",
            mark: row.kind === "stone" ? <StoneMark /> : <CieloMark />,
            onDisconnect: () => setPending(row),
          }))}
        />
      )}
      <AcquirerPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(kind) => {
          setPicker(false);
          setConnectKind(kind);
        }}
      />
      <StoneModal
        open={connectKind === "stone"}
        storeRows={storeRows}
        links={links}
        cieloStoreIds={cieloLinks.map((link) => link.storeId)}
        onClose={() => setConnectKind(null)}
        onSaved={async (storeId) => {
          await reload();
          const order = await requestMonthClose([storeId]);
          if (!order.ok) show(order.message, "danger");
          else show("Stone conectada. Buscando os fechamentos deste mês.", "success");
          setConnectKind(null);
        }}
        onDisconnected={async () => {
          await reload();
          show("Stone desconectada.", "success");
        }}
      />
      <CieloModal
        open={connectKind === "cielo"}
        storeRows={storeRows}
        links={cieloLinks}
        account={cieloAccount}
        stoneStoreIds={links.map((link) => link.storeId)}
        onClose={() => setConnectKind(null)}
        onSaved={async (storeId) => {
          await reload();
          const order = await requestMonthClose([storeId]);
          if (!order.ok) show(order.message, "danger");
          else show("Cielo conectada. Buscando os fechamentos deste mês.", "success");
          setConnectKind(null);
        }}
        onDisconnected={async () => {
          await reload();
          show("Cielo desconectada.", "success");
        }}
      />
      <Modal
        open={pending != null}
        onClose={() => {
          if (!disconnecting) setPending(null);
        }}
        title={pending ? `Desconectar ${pending.name}?` : "Desconectar?"}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)} disabled={disconnecting}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void disconnect()} disabled={disconnecting}>
              {disconnecting ? "Desconectando…" : "Desconectar"}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-t1">
          A WDash deixará de buscar os fechamentos de cartão e Pix desta filial. Os fechamentos já salvos serão mantidos.
        </p>
      </Modal>
    </div>
  );
}

function StoneMark() {
  return <img src="/stone.png" alt="" className="h-full w-full object-contain p-1.5" />;
}

function CieloMark() {
  return <span className="text-[13px] font-bold tracking-tight text-t0">Cielo</span>;
}

function AcquirerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (kind: AcquirerKind) => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Conectar adquirente"
      footer={
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
      }
    >
      <p className="mb-3 text-[13.5px] leading-relaxed text-t1">Escolha a adquirente desta filial.</p>
      <div className="flex flex-col gap-2.5">
        <PickerRow name="Stone" detail="Cartão e Pix" mark={<StoneMark />} onClick={() => onPick("stone")} />
        <PickerRow name="Cielo" detail="Cartão e Pix" mark={<CieloMark />} onClick={() => onPick("cielo")} />
      </div>
    </Modal>
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
      show("Esta filial já está conectada à Cielo. Desconecte a Cielo para continuar.", "danger");
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
            A WDash está conectada à Stone desta filial. Os fechamentos de cartão e Pix são buscados automaticamente
            enquanto a conexão estiver ativa.
          </p>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Informe os dados de acesso da Stone desta filial. A WDash protege esses dados e os usa somente para buscar os
              fechamentos.
            </p>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Ao conectar, a WDash busca os fechamentos disponíveis deste mês, do dia 1 até ontem.
            </p>
          </>
        )}
        {storeRows.length > 1 && (
          <FormField label="Filial" required>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy} {...noAutofill}>
              <option value="" disabled>
                Selecione a filial
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
                Ao desconectar, a WDash deixa de buscar automaticamente os fechamentos de cartão e Pix desta filial.
              </p>
            </div>
          </div>
        ) : (
          <Checkbox
            label="Autorizo a WDash a usar este acesso para buscar os fechamentos de cartão e Pix desta filial."
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
  const [certName, setCertName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyName, setPrivateKeyName] = useState("");
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
    setCertName("");
    setPrivateKey("");
    setPrivateKeyName("");
    setShowSecret(false);
    setAutorizo(false);
  }, [link?.establishmentCode, account?.merchantCode, account?.clientId, storeId]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
    if (stoneStoreIds.includes(storeId)) {
      show("Esta filial já está conectada à Stone. Desconecte a Stone para continuar.", "danger");
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
    setCertName("");
    setPrivateKey("");
    setPrivateKeyName("");
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
            A WDash está conectada à Cielo desta filial. Os fechamentos de cartão e Pix são buscados automaticamente
            enquanto a conexão estiver ativa.
          </p>
        ) : hasAccount ? (
          <>
            <p className="text-[13.5px] leading-relaxed text-t1">
              O acesso da Cielo já está cadastrado. Informe o estabelecimento desta filial.
            </p>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Ao conectar, a WDash busca os fechamentos disponíveis deste mês, do dia 1 até ontem.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Informe os dados de acesso da Cielo e o estabelecimento desta filial. O acesso será usado pelas filiais
              conectadas à mesma conta.
            </p>
            <p className="text-[13.5px] leading-relaxed text-t1">
              Ao conectar, a WDash busca os fechamentos disponíveis deste mês, do dia 1 até ontem.
            </p>
          </>
        )}
        {storeRows.length > 1 && (
          <FormField label="Filial" required>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy} {...noAutofill}>
              <option value="" disabled>
                Selecione a filial
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
                  {showSecret ? (
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
              </div>
            </FormField>
            <CieloFile
              label="Certificado"
              required={!hasAccount}
              fileName={certName}
              emptyLabel="Já cadastrado"
              disabled={busy}
              onPick={(value, name) => {
                setCert(value);
                setCertName(name);
              }}
            />
            <CieloFile
              label="Chave privada"
              required={!hasAccount}
              fileName={privateKeyName}
              emptyLabel="Já cadastrada"
              disabled={busy}
              onPick={(value, name) => {
                setPrivateKey(value);
                setPrivateKeyName(name);
              }}
            />
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
                Ao desconectar, a WDash deixa de buscar automaticamente os fechamentos de cartão e Pix desta filial. O
                acesso da empresa permanece para as outras filiais.
              </p>
            </div>
          </div>
        ) : (
          <Checkbox
            label="Autorizo a WDash a usar este acesso para buscar os fechamentos de cartão e Pix desta filial."
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
  emptyLabel,
  disabled,
  onPick,
}: {
  label: string;
  required: boolean;
  fileName: string;
  emptyLabel: string;
  disabled: boolean;
  onPick: (value: string, fileName: string) => void;
}) {
  return (
    <FormField label={label} required={required}>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-vela-sm)] border border-line bg-bg px-3 py-2 text-[13px] text-t1">
        <span className="truncate">{fileName || (required ? "Escolher arquivo" : emptyLabel)}</span>
        <input
          type="file"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void readCredentialFile(file).then((value) => onPick(value, file.name));
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
