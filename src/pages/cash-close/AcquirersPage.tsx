import { useCallback, useEffect, useState } from "react";
import { Button, Card, Checkbox, FormField, Input, Modal, Select, Skeleton, useToast } from "@/components/ui";
import {
  disconnectStoneLink,
  fetchStoneLinks,
  requestMonthClose,
  saveStoneLink,
  type StoneLink,
} from "@/data/wedash/cashCloseRepo";
import type { Store } from "@/data/wedash/stores";
import { isGestor } from "@/layout/nav-wedash";
import { noAutofill, secretStyle } from "@/lib/noAutofill";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { useScope } from "@/pages/dashboard/useScope";

/** Custos > Adquirentes. A chave é da loja, no mesmo desenho do Millennium. */
export function AcquirersPage() {
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showSkeleton = useMinSkeleton(lojasLoading);
  const [links, setLinks] = useState<StoneLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(false);
  const canEdit = isGestor(session.role);

  const reload = useCallback(async () => {
    try {
      setLinks(await fetchStoneLinks(session.tenantId, lojas.map((l) => l.id)));
    } catch {
      show("Não foi possível carregar a conexão com a Stone. Tente novamente.", "danger");
    } finally {
      setLoading(false);
    }
    // show do toast muda de identidade; a carga segue a loja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tenantId, lojas]);

  useEffect(() => {
    if (lojasLoading) return;
    void reload();
  }, [lojasLoading, reload]);

  const conectadas = links.length;
  const estado = conectadas === 0 ? "Não configurado" : conectadas === lojas.length ? "Conectado" : "Parcial";
  const tom = conectadas === 0 ? "text-t2" : conectadas === lojas.length ? "text-ok" : "text-warn";
  const dot = conectadas === 0 ? "bg-t2" : conectadas === lojas.length ? "bg-ok" : "bg-warn";

  return (
    <div>
      <SectionHeader
        section="Custos"
        title="Adquirentes"
        subtitle="Conecte as adquirentes desta loja para buscar os fechamentos de cartão e Pix na WDash."
      />
      {escolher ? (
        <div className="mt-6 max-w-[720px]">
          <SelectStoreCard />
        </div>
      ) : (
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {showSkeleton || (loading && links.length === 0 && lojas.length > 0) ? (
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
        ) : (
          <Card>
            <div className="mb-3.5 flex items-center gap-3">
              <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-bg-inset">
                <img src="/stone.png" alt="Stone" className="h-full w-full object-contain p-1.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-bold text-t0">Stone</p>
                <p className="mt-0.5 text-[11.5px] text-t2">Cartão e Pix</p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className={`flex items-center gap-1.5 text-xs font-bold ${tom}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                {estado}
                {estado === "Parcial" ? ` · ${conectadas} de ${lojas.length} lojas` : ""}
              </span>
              <Button size="sm" onClick={() => setAberto(true)} disabled={!canEdit || lojas.length === 0}>
                {conectadas > 0 ? "Gerenciar" : "Conectar"}
              </Button>
            </div>
          </Card>
      )}
      </div>
      )}
      <StoneModal
        open={aberto}
        lojas={lojas}
        links={links}
        onClose={() => setAberto(false)}
        onSaved={async (storeId) => {
          await reload();
          const pedido = await requestMonthClose([storeId]);
          if (!pedido.ok) show(pedido.message, "danger");
          else show("Stone conectada. Buscando os fechamentos deste mês.", "success");
          setAberto(false);
        }}
        onDisconnected={async () => {
          await reload();
          show("Stone desconectada.", "success");
        }}
      />
    </div>
  );
}

function StoneModal({
  open,
  lojas,
  links,
  onClose,
  onSaved,
  onDisconnected,
}: {
  open: boolean;
  lojas: Store[];
  links: StoneLink[];
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
  const [mostrarChave, setMostrarChave] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (lojas.length <= 1) setStoreId(lojas[0]?.id ?? "");
    else if (!lojas.some((l) => l.id === storeId)) setStoreId("");
    setAutorizo(false);
  }, [open, lojas, storeId]);

  useEffect(() => {
    setStoneCode(link?.stoneCode ?? "");
    setSecret("");
    setMostrarChave(false);
    setAutorizo(false);
  }, [link?.stoneCode, storeId]);

  function fechar() {
    if (busy) return;
    onClose();
  }

  async function conectar() {
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
  const podeConectar =
    !conectado && autorizo && storeId.length > 0 && stoneCode.trim().length >= 5 && secret.trim().length > 0 && !busy;

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Stone"
      footer={
        <>
          <Button variant="outline" onClick={fechar} disabled={busy}>
            Cancelar
          </Button>
          {conectado ? (
            <Button variant="danger" onClick={() => void desconectar()} disabled={busy}>
              {busy ? "Desconectando…" : "Desconectar"}
            </Button>
          ) : (
            <Button onClick={() => void conectar()} disabled={!podeConectar}>
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
        {lojas.length > 1 && (
          <FormField label="Loja" required>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy} {...noAutofill}>
              <option value="" disabled>
                Selecione a loja
              </option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fantasia}
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
              value={conectado ? "••••••••" : secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Digite a chave secreta"
              style={secretStyle(mostrarChave && !conectado)}
              disabled={travado}
              className="pr-12"
              {...noAutofill}
            />
            {!conectado && (
              <button
                type="button"
                onClick={() => setMostrarChave((m) => !m)}
                aria-label={mostrarChave ? "Ocultar chave" : "Mostrar chave"}
                disabled={busy}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
              >
                {mostrarChave ? (
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
