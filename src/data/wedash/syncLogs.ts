/**
 * Configuracoes > Logs  -  erros/avisos gravados pelo worker Millennium em `sync_log`.
 * RLS: so OWNER / MANAGER / ADMIN_GLOBAL leem. Retencao 120 dias (worker limpa).
 */
import { getSupabase } from "@/lib/supabase";

export type SyncLogLevel = "ERROR" | "WARN";

export type SyncLogEntry = {
  id: string;
  createdAt: string;
  level: SyncLogLevel;
  source: string;
  jobId: string | null;
  jobKind: string | null;
  storeId: string | null;
  storeLabel: string | null;
  day: string | null;
  message: string;
  count: number;
  days: string[];
  detail: Record<string, unknown> | null;
};

/** Origem (etapa do sync)  ->  rotulo na UI. */
export const SYNC_LOG_SOURCE_LABEL: Record<string, string> = {
  job: "Sincronização",
  login: "Acesso ao Millennium",
  vendas: "Vendas",
  margem: "Marca · WEPINK/WPINK",
  cmv: "CMV",
  detalhe_movimento: "Detalhe da venda",
  categorias: "Categorias",
  catalogo: "Catálogo de produtos",
  top_produtos: "Top produtos",
  cupom: "Produtos por venda",
  custo_produto: "CMV por produto",
  itens_pessoa: "Itens por pessoa",
  mapa_produtos: "Mapeamento de produtos",
  gerador: "Gerador da loja",
  eventos: "Eventos de venda",
  vendedoras: "Equipe de vendas",
  fechamento_caixa: "Fechamento de caixa",
  millennium_ocupado: "Millennium ocupado",
};

export const SYNC_JOB_KIND_LABEL: Record<string, string> = {
  SEED: "Carga inicial",
  FORCE: "Atualização manual",
  FORCE_LIGHT: "Atualização manual",
  LIGHT: "Atualização automática",
  HISTORY: "Histórico",
  CLOSE: "Fechamento do dia",
  RANGE: "Período",
  BACKFILL: "Reprocessamento",
};

export function syncLogSourceLabel(source: string): string {
  return SYNC_LOG_SOURCE_LABEL[source] ?? source;
}

type SyncLogText = { summary: string; explanation: string };

const SYNC_LOG_TEXT: Record<string, SyncLogText> = {
  job: {
    summary: "Sincronização interrompida",
    explanation: "A sincronização foi interrompida antes de terminar. Parte dos dados pode não ter sido atualizada.",
  },
  vendas: {
    summary: "Vendas não carregadas",
    explanation:
      "Não foi possível carregar todas as vendas deste período. O faturamento e outros indicadores podem estar incompletos.",
  },
  margem: {
    summary: "Faturamento por marca não carregado",
    explanation:
      "Não foi possível separar o faturamento entre WEPINK e WPINK neste período. O faturamento total pode continuar disponível.",
  },
  cmv: {
    summary: "CMV não carregado",
    explanation:
      "Não foi possível carregar o custo dos produtos deste período. CMV, lucro bruto e margem podem ficar indisponíveis ou incompletos.",
  },
  detalhe_movimento: {
    summary: "Vendas por hora incompletas",
    explanation:
      "Parte das vendas não pôde ser distribuída por horário. Os totais podem estar corretos, mas gráficos por hora podem ficar incompletos.",
  },
  categorias: {
    summary: "Categorias não carregadas",
    explanation:
      "Não foi possível identificar a categoria de parte dos produtos. As análises por categoria podem ficar incompletas.",
  },
  catalogo: {
    summary: "Produtos novos sem categoria",
    explanation:
      "Foram encontrados produtos novos sem categoria identificada no Millennium. Eles podem aparecer fora das análises por categoria.",
  },
  top_produtos: {
    summary: "Top produtos não carregados",
    explanation:
      "Não foi possível carregar todos os produtos vendidos neste período. O ranking de produtos pode ficar incompleto.",
  },
  cupom: {
    summary: "Top produtos e faturamento por marca incompletos",
    explanation:
      "Parte dos produtos vendidos não pôde ser identificada. O ranking de produtos e o faturamento por marca podem ficar incompletos.",
  },
  custo_produto: {
    summary: "CMV por produto não calculado",
    explanation:
      "Não foi possível calcular o CMV de alguns produtos. Lucro bruto e margem por produto podem ficar indisponíveis.",
  },
  itens_pessoa: {
    summary: "Itens por pessoa não gravados",
    explanation:
      "Não foi possível gravar os produtos vendidos por cada pessoa neste dia. Desafios de produtos e categorias podem ficar incompletos.",
  },
  mapa_produtos: {
    summary: "Mapeamento de produtos incompleto",
    explanation:
      "Alguns produtos não puderam ser identificados corretamente. Análises por marca, categoria ou produto podem ficar incompletas.",
  },
  gerador: {
    summary: "Loja sem gerador no Millennium",
    explanation:
      "A loja não possui o gerador necessário configurado no Millennium. Algumas análises de produtos e categorias não puderam ser carregadas.",
  },
  eventos: {
    summary: "Eventos de venda não carregados",
    explanation:
      "Não foi possível carregar todos os eventos de venda deste período. Algumas informações detalhadas podem ficar incompletas.",
  },
  fechamento_caixa: {
    summary: "Valor digitado não gravado",
    explanation:
      "Não foi possível gravar o fundo, a sangria, o fechamento ou o valor digitado deste dia. O faturamento não foi alterado.",
  },
  vendedoras: {
    summary: "Equipe de vendas não sincronizada",
    explanation:
      "Não foi possível atualizar todos os colaboradores da equipe de vendas. Rankings e indicadores individuais podem ficar incompletos.",
  },
  millennium_ocupado: {
    summary: "Millennium lento · sincronização mais demorada",
    explanation:
      "O Millennium está respondendo mais lentamente que o normal. A sincronização continua, mas pode levar mais tempo para terminar.",
  },
};

/** Nome da pessoa nas mensagens do worker: `Pessoa "MARIA" (gerador 123) ...`. */
function personName(message: string): string {
  return message.match(/Pessoa "([^"]+)"/)?.[1]?.trim().toUpperCase() || "a pessoa";
}

function syncLogText(e: Pick<SyncLogEntry, "source" | "message">): SyncLogText {
  if (e.source === "login") {
    return /senha|password|inv[aá]lid|recusad/i.test(e.message)
      ? {
          summary: "Senha do Millennium inválida",
          explanation:
            "A senha salva para o Millennium não foi aceita. A sincronização ficará interrompida até que a senha seja atualizada.",
        }
      : {
          summary: "Não foi possível acessar o Millennium",
          explanation:
            "A WDash não conseguiu acessar o Millennium durante esta sincronização. Os dados deste período podem não estar atualizados.",
        };
  }
  if (e.source === "vendedoras" && /mais de um cadastro/i.test(e.message)) {
    return {
      summary: "Colaborador com cadastro duplicado no Millennium",
      explanation: `Foram encontrados vários cadastros compatíveis com ${personName(e.message)}. As vendas foram mantidas pelo nome, sem vínculo com um cadastro específico.`,
    };
  }
  if (e.source === "vendedoras" && /não está no cadastro/i.test(e.message)) {
    return {
      summary: "Colaborador não identificado no Millennium",
      explanation: `A venda foi mantida pelo nome, mas não foi possível vincular ${personName(e.message)} ao cadastro de colaboradores.`,
    };
  }
  return (
    SYNC_LOG_TEXT[e.source] ?? {
      summary: syncLogSourceLabel(e.source),
      explanation: "Ocorreu um problema nesta etapa da sincronização. Veja as informações técnicas para mais detalhes.",
    }
  );
}

/** Problema em frase curta (linha principal da lista). */
export function syncLogSummary(e: Pick<SyncLogEntry, "source" | "message">): string {
  return syncLogText(e).summary;
}

/** O que aconteceu e o impacto no painel, em linguagem simples (campo "Mensagem" do detalhe). */
export function syncLogExplanation(e: Pick<SyncLogEntry, "source" | "message">): string {
  return syncLogText(e).explanation;
}

export type SyncLogQuery = {
  tenantId: string;
  from?: Date | null;
  to?: Date | null;
  level?: SyncLogLevel | null;
  storeId?: string | null;
  source?: string | null;
  limit?: number;
};

type Row = {
  id: string;
  created_at: string;
  level: SyncLogLevel;
  source: string;
  job_id: string | null;
  job_kind: string | null;
  store_id: string | null;
  store_label: string | null;
  day: string | null;
  message: string;
  detail: Record<string, unknown> | null;
};

export async function fetchSyncLogs(q: SyncLogQuery): Promise<SyncLogEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let req = sb
    .from("sync_log")
    .select("id, created_at, level, source, job_id, job_kind, store_id, store_label, day, message, detail")
    .eq("tenant_id", q.tenantId)
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 500);
  if (q.from) req = req.gte("created_at", q.from.toISOString());
  if (q.to) req = req.lt("created_at", q.to.toISOString());
  if (q.level) req = req.eq("level", q.level);
  if (q.storeId) req = req.eq("store_id", q.storeId);
  if (q.source) req = req.eq("source", q.source);
  const { data, error } = await req;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => {
    const detail = r.detail ?? null;
    const days = Array.isArray(detail?.days) ? (detail.days as string[]) : r.day ? [r.day] : [];
    return {
      id: r.id,
      createdAt: r.created_at,
      level: r.level,
      source: r.source,
      jobId: r.job_id,
      jobKind: r.job_kind,
      storeId: r.store_id,
      storeLabel: r.store_label,
      day: r.day,
      message: r.message,
      count: Number(detail?.count ?? 1) || 1,
      days,
      detail,
    };
  });
}
