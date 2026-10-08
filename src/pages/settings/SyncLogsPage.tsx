import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Timeline,
  type TimelineEvent,
  useToast,
} from "@/components/ui";
import { TimelineSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { useActiveSession } from "@/session/SessionProvider";
import { hydrateSessionStores, storesForSession } from "@/data/wedash/stores";
import {
  SYNC_JOB_KIND_LABEL,
  fetchSyncLogs,
  syncLogExplanation,
  syncLogSourceLabel,
  syncLogSummary,
  type SyncLogEntry,
  type SyncLogLevel,
} from "@/data/wedash/syncLogs";
function fmtAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return fmtWhen(iso);
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "29/09/2026" · "29/09/2026 a 30/09/2026" (dias seguidos) · lista quando há buraco entre os dias. */
function fmtDays(days: string[]): string {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 1) return fmtDay(sorted[0]!);
  const seguidos = sorted.every(
    (d, i) => i === 0 || Date.parse(`${d}T12:00:00Z`) - Date.parse(`${sorted[i - 1]}T12:00:00Z`) === 86_400_000,
  );
  return seguidos ? `${fmtDay(sorted[0]!)} a ${fmtDay(sorted[sorted.length - 1]!)}` : sorted.map(fmtDay).join(", ");
}

/**
 * Ícone e cor do símbolo da Timeline por origem — padrão Activity Logs do Vela (símbolo de uma cor só,
 * sem fundo). `\uFE0E` força o símbolo de texto: sem ele o navegador usa o emoji colorido.
 */
const SOURCE_STYLE: Record<string, { icon: string; tint: string }> = {
  login: { icon: "\u{1F511}", tint: "var(--bad)" },
  job: { icon: "\u27F3", tint: "var(--bad)" },
  vendas: { icon: "\u{1F5CE}", tint: "var(--acc)" },
  margem: { icon: "\u{1F5E0}", tint: "var(--ok)" },
  cmv: { icon: "\u{1F5E0}", tint: "var(--ok)" },
  custo_produto: { icon: "\u{1F5E0}", tint: "var(--ok)" },
  detalhe_movimento: { icon: "\u{1F6CD}\uFE0E", tint: "var(--info)" },
  cupom: { icon: "\u{1F6CD}\uFE0E", tint: "var(--info)" },
  itens_pessoa: { icon: "\u{1F6CD}\uFE0E", tint: "var(--info)" },
  categorias: { icon: "\u{1F5C4}\uFE0E", tint: "var(--info)" },
  catalogo: { icon: "\u{1F5C4}\uFE0E", tint: "var(--info)" },
  top_produtos: { icon: "\u{1F5C4}\uFE0E", tint: "var(--info)" },
  mapa_produtos: { icon: "\u{1F5C4}\uFE0E", tint: "var(--info)" },
  gerador: { icon: "\u2699\uFE0E", tint: "var(--acc)" },
  eventos: { icon: "\u{1F5D3}\uFE0E", tint: "var(--info)" },
  vendedoras: { icon: "\u{1F5E3}\uFE0E", tint: "var(--acc)" },
  fechamento_caixa: { icon: "\u{1F5D3}\uFE0E", tint: "var(--acc)" },
  millennium_ocupado: { icon: "\u23F1\uFE0E", tint: "var(--warn)" },
};

function sourceStyle(e: SyncLogEntry): { icon: string; tint: string } {
  return (
    SOURCE_STYLE[e.source] ??
    (e.level === "ERROR" ? { icon: "\u2716\uFE0E", tint: "var(--bad)" } : { icon: "\u26A0\uFE0E", tint: "var(--warn)" })
  );
}

function LevelBadge({ level }: { level: SyncLogLevel }) {
  return level === "ERROR" ? <Badge variant="danger">Erro</Badge> : <Badge variant="warning">Aviso</Badge>;
}

/**
 * Configurações > Logs — erros e avisos da sincronização com o Millennium.
 * Leitura só para OWNER / MANAGER (RLS); retenção de 120 dias.
 */
export function SyncLogsPage() {
  const session = useActiveSession();
  const canView = session.role === "OWNER" || session.role === "MANAGER" || session.role === "ADMIN_GLOBAL";

  const [catalogTick, setCatalogTick] = useState(0);
  const lojas = useMemo(() => storesForSession(session.stores), [session.stores, catalogTick]);
  useEffect(() => {
    let cancelled = false;
    if (session.stores.length > 0) {
      void hydrateSessionStores(session.tenantId, session.stores).then(() => {
        if (!cancelled) setCatalogTick((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, session.stores]);

  const [nivel, setNivel] = useState<SyncLogLevel | "">("");
  const [busca, setBusca] = useState("");
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [error, setError] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<SyncLogEntry | null>(null);
  const { show } = useToast();

  const carregar = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      setLogs(await fetchSyncLogs({ tenantId: session.tenantId, level: nivel || null }));
    } catch (e) {
      console.warn("fetchSyncLogs:", e);
      setError("Não foi possível carregar os logs. Tente novamente.");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [canView, session.tenantId, nivel]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const lojaNome = useCallback(
    (e: SyncLogEntry) => {
      if (!e.storeId && !e.storeLabel) return "Todas as lojas";
      const loja = lojas.find((s) => s.id === e.storeId);
      return loja ? loja.fantasia : e.storeLabel ?? "—";
    },
    [lojas],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((e) =>
      [syncLogSummary(e), syncLogExplanation(e), e.message, syncLogSourceLabel(e.source), lojaNome(e)].some((t) =>
        t.toLowerCase().includes(q),
      ),
    );
  }, [logs, busca, lojaNome]);

  const events: TimelineEvent[] = filtrados.map((e) => {
    const temLoja = Boolean(e.storeId || e.storeLabel);
    const rotina = e.jobKind ? (SYNC_JOB_KIND_LABEL[e.jobKind] ?? e.jobKind) : "Sincronização";
    return {
      id: e.id,
      title: (
        <button
          type="button"
          onClick={() => setDetalhe(e)}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left"
        >
          <strong className="font-bold">{syncLogSummary(e)}</strong>
          <LevelBadge level={e.level} />
        </button>
      ),
      time: [rotina, fmtAgo(e.createdAt), temLoja ? lojaNome(e) : null, e.count > 1 ? `${e.count} ocorrências` : null]
        .filter(Boolean)
        .join(" · "),
      color: "transparent",
      icon: (
        <span className="text-[13px]" style={{ color: sourceStyle(e).tint }}>
          {sourceStyle(e).icon}
        </span>
      ),
    };
  });

  if (!canView) {
    return <p className="text-sm text-t2">Somente Gestores podem visualizar os logs.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-col sm:flex-row sm:justify-end print:hidden">
        <div className="flex flex-wrap items-center justify-start gap-2 sm:w-[288px] sm:justify-end">
          <Input
            placeholder="Buscar nos logs…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-[38px] w-[160px]"
          />
          <Select
            value={nivel}
            onChange={(e) => setNivel(e.target.value as SyncLogLevel | "")}
            className="h-[38px] w-auto"
          >
            <option value="">Todos os eventos</option>
            <option value="ERROR">Erros</option>
            <option value="WARN">Avisos</option>
          </Select>
        </div>
      </div>

      <Card padding="lg">
        {error ? (
          <span className="block py-6 text-center text-[12px] text-bad">{error}</span>
        ) : showSkeleton ? (
          <TimelineSkeleton rows={5} />
        ) : events.length === 0 ? (
          busca.trim() || nivel ? (
            <EmptyState
              framed={false}
              icon="🔍"
              title="Nenhum resultado"
              description="Tente outra busca ou altere o tipo de evento."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBusca("");
                    setNivel("");
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              framed={false}
              icon="✅"
              title="Tudo certo"
              description="Nenhum erro ou aviso na sincronização."
            />
          )
        ) : (
          <Timeline events={events} />
        )}
      </Card>

      <Modal
        open={detalhe != null}
        onClose={() => setDetalhe(null)}
        title="Detalhe do log"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
            {detalhe && (
              <Button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(logParaSuporte(detalhe, lojaNome(detalhe)))
                    .then(() => show("Detalhes copiados.", "success"))
                    .catch(() => show("Não foi possível copiar.", "danger"));
                }}
              >
                Copiar detalhes
              </Button>
            )}
          </>
        }
      >
        {detalhe && <LogDetail entry={detalhe} loja={lojaNome(detalhe)} />}
      </Modal>
    </div>
  );
}

/** Bloco de texto para colar em chamado / conversa de suporte. */
const DETAIL_KEYS_INTERNAS = new Set(["count", "days", "worker", "stack", "test", "erpUser"]);

function erpUserOf(e: SyncLogEntry): string | null {
  return typeof e.detail?.erpUser === "string" ? e.detail.erpUser : null;
}

function workerInfo(e: SyncLogEntry): { version?: string; startedAt?: string } | null {
  const w = e.detail?.worker;
  return w && typeof w === "object" ? (w as { version?: string; startedAt?: string }) : null;
}

function stackOf(e: SyncLogEntry): string | null {
  return typeof e.detail?.stack === "string" ? e.detail.stack : null;
}

function logParaSuporte(e: SyncLogEntry, loja: string): string {
  const w = workerInfo(e);
  const stack = stackOf(e);
  return [
    `[WeDash sync_log] ${e.level} · ${e.source} · ${syncLogSummary(e)}`,
    `explicação: ${syncLogExplanation(e)}`,
    `log_id: ${e.id}`,
    `quando: ${e.createdAt}`,
    `job: ${e.jobKind ?? "—"} (${e.jobId ?? "sem job_id"})`,
    `usuário ERP: ${erpUserOf(e) ?? "—"}`,
    `loja: ${loja} (store_id ${e.storeId ?? "—"}, código ${e.storeLabel ?? "—"})`,
    `dias: ${e.days.join(", ") || "—"}`,
    `ocorrências: ${e.count}`,
    `worker: ${w?.version ?? "—"} (iniciado ${w?.startedAt ?? "—"})`,
    `mensagem: ${e.message}`,
    `detail: ${JSON.stringify(Object.fromEntries(Object.entries(e.detail ?? {}).filter(([k]) => k !== "stack" && k !== "worker" && k !== "erpUser")))}`,
    ...(stack ? ["stack:", stack] : []),
  ].join("\n");
}

function LogDetail({ entry, loja }: { entry: SyncLogEntry; loja: string }) {
  const extra = Object.entries(entry.detail ?? {}).filter(([k]) => !DETAIL_KEYS_INTERNAS.has(k));
  const w = workerInfo(entry);
  const stack = stackOf(entry);
  const mono = (v: string) => <span className="font-mono text-xs">{v}</span>;
  return (
    <div className="space-y-2.5 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-1 text-[14px] font-semibold text-t0">
        {syncLogSummary(entry)}
        <LevelBadge level={entry.level} />
      </p>
      <DetailRow label="Quando" value={fmtWhen(entry.createdAt)} />
      <DetailRow label="Nível" value={<LevelBadge level={entry.level} />} />
      <DetailRow label="Origem" value={syncLogSourceLabel(entry.source)} />
      <DetailRow
        label="Tipo de sincronização"
        value={entry.jobKind ? (SYNC_JOB_KIND_LABEL[entry.jobKind] ?? entry.jobKind) : "Sincronização"}
      />
      <DetailRow label="Loja" value={loja} />
      {entry.days.length > 0 && <DetailRow label="Período afetado" value={fmtDays(entry.days)} />}
      <DetailRow
        label="Ocorrências"
        value={entry.count > 1 ? `${entry.count} vezes nesta sincronização` : "1 vez nesta sincronização"}
      />
      <div className="pt-2">
        <span className="mb-1.5 block text-t2">Mensagem</span>
        <p className="leading-relaxed text-t0">{syncLogExplanation(entry)}</p>
      </div>
      <details className="group rounded-[var(--radius-vela-md)] border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-semibold text-t1 hover:text-t0">
          Informações técnicas
          <span className="text-t2 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          <DetailRow label="Identificador da sincronização" value={mono(entry.id)} />
          {entry.jobId && <DetailRow label="Identificador da tarefa" value={mono(entry.jobId)} />}
          {erpUserOf(entry) && <DetailRow label="Usuário do Millennium" value={erpUserOf(entry)} />}
          {w?.version && <DetailRow label="Versão da sincronização" value={mono(w.version)} />}
          {extra.map(([k, v]) => (
            <DetailRow key={k} label={k} value={typeof v === "string" ? v : JSON.stringify(v)} />
          ))}
          <div className="pt-1">
            <span className="mb-1.5 block text-t2">Detalhes técnicos do erro</span>
            <pre className={PRE}>{stack ? `${entry.message}\n\n${stack}` : entry.message}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}

const PRE =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-vela-md)] border border-line bg-bg-2 p-3 font-mono text-xs text-t0";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-t2">{label}</span>
      <span className="text-right text-t0">{value}</span>
    </div>
  );
}
