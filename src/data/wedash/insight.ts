/**
 * Leitura de tela. No produto, o LLM redige a partir de numeros da camada de
 * metricas; aqui a frase e montada por regra com os mesmos numeros.
 *
 * Regra do produto: so aparece se disser algo que os numeros da tela nao
 * dizem. Repetir um valor que ja esta num indicador nao conta.
 *
 * Um so card de leitura na tela, nao um card de leitura mais um de alertas de
 * sistema separado: os alertas (`v.alertas`  -  sync atrasado, nota pendente)
 * entram como frase inicial da mesma leitura, antes da narrativa de
 * desempenho, porque os dois respondem a mesma pergunta de quem abre a tela:
 * "o que eu preciso saber agora?".
 */
import type { StoreView } from "./dashboard";

export function buildStoreInsight(v: StoreView): string | null {
  const partes = v.alertas.map((a) => a.text);
  const narrativa = v.scopeView === "network" ? readNetwork(v) : v.scopeView === "day" ? null : readMonth(v);
  if (narrativa) partes.push(narrativa);
  return partes.length > 0 ? partes.join(" ") : null;
}

function readNetwork(v: StoreView): string | null {
  if (v.scope.division) return null; // regua vira participacao da marca, nao fala de meta
  const regua = v.regua;
  if (!regua || regua.length < 2) return null;
  const pior = regua[0];
  const melhor = regua[regua.length - 1];

  const distancia = melhor.attainmentPct - pior.attainmentPct;
  if (distancia < 4) return null;

  const queda = pior.variacaoDiaValor !== null && pior.variacaoDiaValor < -0.5;
  const tamanho = pior.variacaoDiaValor === null ? "" : `${Math.abs(Math.round(pior.variacaoDiaValor))}%`;
  const todaySlice = queda
    ? `${pior.name} está ${tamanho} abaixo do mesmo dia da semana passada e em ${pior.atingimentoTexto} do mês.`
    : `${pior.name} está em ${pior.atingimentoTexto} do mês, ${Math.round(distancia)} pontos atrás de ${melhor.name}.`;
  const parteAcao = queda
    ? `Vale checar o que mudou hoje em ${pior.name} (equipe, fluxo de loja) e reagir ainda no dia.`
    : `Pra fechar a distância, veja o que ${melhor.name} está fazendo diferente e leve pra ${pior.name}.`;
  return `${todaySlice} ${parteAcao}`;
}

function readMonth(v: StoreView): string | null {
  const salesCount = v.kpiSalesCount.delta;
  const ticket = v.kpiTicket.delta;
  const pa = v.kpiPA.delta;
  if (!salesCount && !ticket) return null;

  const bateu = v.tileMeta ? v.tileMeta.barPct >= 100 : false;

  if (bateu && salesCount && !salesCount.positive) {
    return `Bateu a meta com menos gente na loja: os atendimentos caíram ${salesCount.value} contra o período anterior e o ticket segurou o resultado. Como a meta ficou baixa pro histórico, vale reforçar a escala ou uma ação de captação no próximo mês, antes que o fluxo caia de novo.`;
  }
  if (!bateu && salesCount && !salesCount.positive && ticket?.positive) {
    return `Menos gente entrando, gastando mais: os atendimentos caíram ${salesCount.value} e o ticket subiu ${ticket.value}. O problema é fluxo, não conversão, e o ticket sozinho não fecha a meta — vale investir em divulgação, vitrine ou ação na porta pra trazer mais gente pra loja.`;
  }
  if (pa && !pa.positive && ticket && !ticket.positive) {
    return `O ticket caiu por PA: ${pa.value} a menos de peça por atendimento. A equipe está vendendo o item principal e deixando o segundo na prateleira — reforçar oferta de segunda peça e kit no caixa tende a recuperar o PA.`;
  }
  return null;
}
