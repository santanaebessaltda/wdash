/**
 * Intents e respostas curtas em tom humano (estilo Néctar).
 * Números e gravação ficam nos briefs / drafts — aqui só o jeito de falar.
 */

export type JarvisIntent =
  | "greeting"
  | "capability"
  | "analyze_sales"
  | "analyze_stock"
  | "seasonal"
  | "challenge"
  | "goal"
  | "schedule"
  | "navigate"
  | "scroll"
  | "authorize"
  | "unknown";

function normalizeIntentText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Pedido de meta / sugestão / reajuste — não pode cair no atalho de “vendas de hoje”
 * só porque a frase cita “valores vendidos”.
 */
export function looksLikeGoalAdvice(raw: string): boolean {
  const p = normalizeIntentText(raw);
  return /meta|comissao|premiacao|escada|reajust|sugest|novo valor|valor sugerido|valor da meta|posso (baixar|subir|mudar|alterar)|vai bater|nao vai bater|ating(ir|imento)|proponha|propor (um |o )?valor/.test(
    p,
  );
}

/** Pergunta clara de leitura de vendas (atalho loadSalesBrief). */
export function looksLikeSalesQuery(raw: string): boolean {
  const p = normalizeIntentText(raw);
  if (looksLikeGoalAdvice(p)) return false;
  if (looksLikeChallengeAdvice(p)) return false;
  return (
    /quanto (eu |a loja |a rede |nos |voce )?(vend|faturou)|vendi\b|vendeu\b|vendemos\b|faturamento|ticket|p\.?\s*a\.?\b|margem|analis(e|ar)? (as? |o )?(venda|faturamento)|como (esta|tá) (a |o )?(loja|rede|grupo|venda|faturamento)/.test(
      p,
    ) || /^(e )?(em |na |no )?(todas( as)? filiais|a rede|a loja)\??$/.test(p.trim())
  );
}

function looksLikeChallengeAdvice(raw: string): boolean {
  const p = normalizeIntentText(raw);
  return /desafio/.test(p);
}

export function classifyIntent(raw: string): JarvisIntent {
  const p = normalizeIntentText(raw);

  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|eai)\b/.test(p) || p.includes("tudo bem")) return "greeting";
  if (/o que (voce|vc) (faz|pode)|como (voce|vc) funciona|suas habilidades|no que (voce|vc) ajuda/.test(p)) {
    return "capability";
  }
  if (/autorizo|pode criar|pode gravar|confirma|pode seguir|fechado pode/.test(p)) return "authorize";
  // Antes de navigate/vendas — “rolar a página” não é abrir tela nem faturamento.
  if (
    /rolar|rola\b|scroll|desce(r)?( a pagina)?|sobe(r)?( a pagina)?|pro topo|pro final|fim da pagina|pra baixo|pra cima/.test(
      p,
    )
  ) {
    return "scroll";
  }
  if (/(abre|abrir|entra|entrar|vai (pra|pro|para)|vamos (pra|pro|para)|mostra|mostrar|me leva|abre a tela)/.test(p)) {
    return "navigate";
  }
  if (looksLikeChallengeAdvice(p)) return "challenge";
  if (looksLikeGoalAdvice(p)) return "goal";
  if (/escala|folga|6\s*[x×]\s*1|plantao|turno/.test(p)) return "schedule";
  if (/sazonal|dia das maes|black friday|natal|pascoa|namorados|datas comemorativas/.test(p)) return "seasonal";
  if (/estoque|parado|encalhe|cobertura|sem girar|parado na prateleira/.test(p)) return "analyze_stock";
  if (looksLikeSalesQuery(p)) return "analyze_sales";
  return "unknown";
}

export function jarvisReply(question: string): string {
  const intent = classifyIntent(question);
  switch (intent) {
    case "greeting":
      return "E aí. Tô no chat — vendas, estoque, meta, desafio, escala, ou te levo pra uma tela. Por onde vamos?";
    case "capability":
      return "No chat eu leio a base do Dashboard, monto e ajusto meta, desafio e escala com você, e abro telas se pedir. Gravar só depois do seu Autorizar no card.";
    case "analyze_sales":
      return "Deixa eu olhar as vendas aí…";
    case "analyze_stock":
      return "Vou cruzar estoque com as vendas dos últimos 30 dias pra achar o que tá parado.";
    case "seasonal":
      return "Deixa eu ver o que vem de sazonal e feriado…";
    case "challenge":
      return "Bora montar o desafio. Me fala filial, período, modo e prêmio — ou manda um com produto parado. Eu mostro o rascunho e só gravo se você autorizar.";
    case "goal":
      return "Bora a meta. Fala a filial, o mês e o valor — ou pede uma sugestão pelo histórico. Eu mostro a escada e espero seu Autorizar.";
    case "schedule":
      return "Na escala eu uso o mesmo motor do montador. Me diz a filial e o mês — proponho o rascunho e só gero de verdade com o seu OK.";
    case "navigate":
      return "Pode falar tipo: abre Visão geral, vai pro Financeiro, abre Escala…";
    case "scroll":
      return "Posso rolar a página — sobe, desce, topo ou final.";
    case "authorize":
      return "Ainda não tenho rascunho pra gravar. Quando a gente montar algo, eu peço seu OK.";
    default:
      return "Manda aí — vendas, estoque, desafio, meta, escala, rolar a página, ou “abre Visão geral”. Se for criar, a gente fecha o detalhe e eu só gravo com autorização.";
  }
}
