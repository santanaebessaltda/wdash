# JARVIS — Auditoria técnica (somente leitura)

**Data:** 2026-10-30  
**Escopo:** implementação atual em `src/components/wedash/jarvis/*`, `goalCommit.ts`, `memoryRepo.ts`, `supabase/functions/jarvis-ai/index.ts`, `goalsRepo.ts`.  
**Regra desta etapa:** nenhum código foi alterado; conclusões baseadas só no que o código faz.

---

## A. Diagrama do fluxo real

```
Gestor envia texto
        │
        ▼
JarvisProvider.reply(q)                    [JarvisProvider.tsx ~592]
  ├─ setMessages(+user)  (async; ref ainda sem q)
  ├─ turnId = t-{ts}-{rand}
  ├─ history = messagesRef.slice(-12)  ← SEM a mensagem atual
  │
  ├─ loadJarvisMemory → memoryTextRef
  │
  ├─ onGoalThread?  (goalDraftRef≠null OU looksLikeGoalConversation)
  │     │
  │     ▼
  │   discussGoal(historyBlob, prev, {turnId})   ← EAGER APPLY
  │     historyBlob = messagesRef + q (até 16)
  │     syncGoalDraft(draft)  → ref + sessionStorage
  │     setGoalDraft(null)    → React state do card fica null
  │     se spokenReply → finish(spokenReply); RETURN (LLM não roda)
  │
  ├─ jarvisLlmTurn(history, q, llmSession, hooks)  [llmClient.ts]
  │     loop até 6 rodadas → Edge jarvis-ai (OpenAI + SYSTEM_PROMPT + tools)
  │     contextNote = resumo + ESTADO_OPERACIONAL_META (JSON do draft)
  │     │
  │     ├─ tool draft_goal → hooks.onDraftGoal(q)  ← ignora arg paraphrase;
  │     │                      discussGoal(q, prev, {mesmo turnId})  → SKIP se já eager
  │     ├─ tool commit_draft → onCommitDraft:
  │     │                      discussGoal(blob, {turnId}-commit)  ← NOVO turnId!
  │     │                      authorizeGoal → commitGoal(form) → saveGoal DB
  │     ├─ analyze_* → briefs (somente leitura)
  │     └─ remember/forget_fact → jarvis_memory
  │
  ├─ pós-LLM: se stalling/lost → naturalGoalAskFromDraft (substitui fala)
  └─ finish(answer) → speakAnswer → bolhas no chat
```

### Quem interpreta a intenção?

| Camada | O que faz |
|--------|-----------|
| **Regex em `discussGoal` / helpers** | Mês, R$, copiar, sim/não, inspeção, pesos, `confirmedMount`, checklist |
| **Eager `discussGoal`** | Aplica mutações no rascunho **antes** do LLM |
| **LLM (OpenAI)** | Escolhe tools; redige a fala; **pode** narrar números sem mutar estado |
| **`spokenReply`** | Bypass do LLM em cópia/inspeção/pesos |
| **Fallbacks pós-LLM** | `naturalGoalAskFromDraft`, `speakGoalDraftConfig` se “não achei meta” |

Não há um único “intent router”. Há **vários classificadores regex + o modelo**.

---

## B. Fontes de verdade

| Informação | Fonte real no código | Pode divergir da fala? |
|------------|----------------------|------------------------|
| `form.target` (R$ da meta) | `goalDraftRef` / sessionStorage, mutado só por `discussGoal` (`parseGoalTarget`, `suggestGoalTarget`) | **Sim** — LLM pode citar outro R$ |
| Níveis / grupos / bônus | `form.tiers` / `form.groups` no mesmo draft | Sim, se LLM inventar % |
| Período destino | `form.startsOn/endsOn` | Sim |
| Origem da cópia | `copiedFrom` + `copyStatus` | Sim se LLM mentir “copiei” |
| Checklist / path | `assembly.*` | Fallbacks usam checklist e **ignoram a pergunta** |
| Proposta 3 cenários | `draft.proposal` (informativo); `form.target` é o que grava | LLM pode falar `proposal` ≠ `form.target` |
| Memória “me conhece” | tabela `jarvis_memory` | Sim |
| Chat | `sessionStorage` chat history | Independente do draft |
| Persistência final | `commitGoal` → `saveGoal` com **`draft.form` do ref** | Fala de sucesso ≠ valor se LLM mentir |

**Resposta à pergunta central:**  
A verdade operacional da meta é o **`goalDraft` no ref + sessionStorage**, alimentado por **`discussGoal`**.  
O **modelo não é fonte de verdade** do valor gravável, mas **controla a fala** e **dispara** `commit_draft`.  
O **banco** só entra na cópia (`fetchGoals`) e no `saveGoal`.  
O **React state `goalDraft`** fica propositalmente `null` (sem card); o ref é quem manda.

---

## C. Causas confirmadas (pelo código)

### C1. O LLM pode anunciar um R$ sem atualizar `form.target`

- `draft_goal` / eager só alteram target se `parseGoalTarget(lastUser)` achar R$ **ou** `looksLikeAskValueSuggestion(lastUser)` disparar `suggestGoalTarget`.
- `looksLikeAskValueSuggestion` **não inclui** a palavra `recomenda` (só `suger|propor|ideia|quanto seria|…`):

```76:83:src/components/wedash/jarvis/goalDraft.ts
export function looksLikeAskValueSuggestion(text: string): boolean {
  const p = norm(text);
  return /suger|propor|ideia de (meta|valor)|quanto (seria|fica|voce|vc)|me (da|dá) (um |uma )?(valor|ideia|numero|número)|pode (suger|calcular|propor)|basead|historico|histórico|nao sei|não sei|sem ideia|voce sugere|você sugere|valor vc sugere|valor voce sugere|da pra melhorar|da para melhorar/.test(
    p,
  );
}
```

- Caso “qual valor você **recomenda**?” → regex pode **falhar** → `form.target` permanece (ex.: 244.600) enquanto o modelo inventa/calcula 257.000 na prosa.
- **Não há** checagem `fala.R$ === form.target` antes de `commitGoal`.

### C2. Inspeção de níveis pode não interceptar a pergunta

`looksLikeInspectGoalDraft` reconhece `como ficou|ficaria`, mas **não** `como ficam`:

```132:143:src/components/wedash/jarvis/goalDraft.ts
export function looksLikeInspectGoalDraft(text: string): boolean {
  if (looksLikeAskGroupWeightAdvice(text)) return false;
  const p = norm(text).trim();
  return (
    /como (ficou|esta|saiu|ficaria)/.test(p) ||
    ...
```

Se a pergunta for “como ficam os níveis?”, o fluxo vai ao **LLM**, que pode simular níveis com o R$ da narrativa (257k) sem ler `form.target` (244.600).

### C3. `commit_draft` reexecuta `discussGoal` com **outro** `turnId`

```712:726:src/components/wedash/jarvis/JarvisProvider.tsx
            const { draft } = await discussGoal(historyBlob || q, ctx, goalDraftRef.current, {
              turnId: `${turnId}-commit`,
            });
            syncGoalDraft(draft);
            ...
            return (await authorizeGoal({ silent: true })) ?? ...
```

- Eager usou `turnId`; commit usa `` `${turnId}-commit` `` → **idempotência não protege**.
- Segunda passagem pode alterar assembly/flags; o valor gravado é o `form` **após** essa segunda passagem.

### C4. Quem grava é o ref; quem fala é o modelo

```501:520:src/components/wedash/jarvis/JarvisProvider.tsx
      const draft = goalDraftRef.current;
      if (!goalCanCommit(draft)) { ... }
      const res = await commitGoal(session.tenantId, draft.form, { published: false });
```

```14:49:src/components/wedash/jarvis/goalCommit.ts
export async function commitGoal(...) {
  ...
  target: ready.target!,
  ...
  await saveGoal(tenantId, null, { ... });
}
```

- Sucesso verbal do LLM **não** valida o payload.
- `authorizeGoal` exige `goalCanCommit` (inclui `confirmedMount`), mas o LLM pode **dizer** “vou gravar” mesmo quando a tool devolve erro — só orientação de prompt, sem enforcement na fala.

### C5. Fallback de checklist pode ignorar a pergunta atual

```817:821:src/components/wedash/jarvis/JarvisProvider.tsx
        if (
          draftNow &&
          (looksLikeStallingGoalReply(answer) || looksLikeLostGoalReply(answer, draftNow))
        ) {
          answer = naturalGoalAskFromDraft(draftNow);
        }
```

`naturalGoalAskFromDraft` devolve o **próximo passo do checklist** (ex.: “Divisão por grupo…”) sem olhar o texto do Gestor.  
Caso “Você falou 257 mas a meta está 244.600” → se o modelo “perder o fio”, o fallback pergunta grupos — **confirmado no código**.

### C6. Cálculo 5% ≠ 257k a partir de 220k

Fórmula real:

```1060:1137:src/components/wedash/jarvis/goalDraft.ts
    // base = média YoY + mês recente (ou um dos dois)
    growthPct = YoY observado clampado OU hipótese 0.05
    // + ajuste leve de tendência 3 meses
    recommended = roundHundred((baseCents/100) * (1+growthPct) * bias.factor)
```

- `220.000 × 1,05 = 231.000`, não 257.000.
- Se o modelo **explica** “+5% sobre 220k = 257k”, isso é **erro do LLM**, não do motor.
- O motor pode chegar a ~257k com base > 220k, growth ≠ 5%, ou sazonal — mas a **narração** “5% de 220k” não está amarrada ao cálculo.

### C7. `spokenReply` / eager competem com o LLM no mesmo turno

- Eager sempre roda no fio de meta.
- Se houver `spokenReply`, o LLM **não** roda.
- Se não houver, o LLM pode chamar `draft_goal` → `discussGoal` de novo com o **mesmo** `turnId` → `skipped: true` (idempotente).
- Ou seja: **dois mecanismos** no mesmo turno; um silenciado por `turnId`, outro (commit) não.

---

## D. Hipóteses (plausíveis, sem prova de runtime neste caso)

| ID | Hipótese | Por que é plausível | O que faltaria para confirmar |
|----|----------|---------------------|-------------------------------|
| H1 | No caso 244.6→257→save 244.6, o 257k nunca entrou em `form.target` | C1 + C2 | Log `form.target` antes/depois de cada `discussGoal` e texto exato da fala |
| H2 | `suggestGoalTarget` rodou 2× e devolveu valores diferentes; o save usou a 1ª | Motor é async/DB; commit re-roda discussGoal | Log `suggested.amount` + `form.target` no commit |
| H3 | “Vamos deixar 45 e 55” → LLM chamou `commit_draft` com `confirmedMount` já true | `commit_draft` não exige frase de “salvar”; só `goalCanCommit` | Log tool calls + `assembly` no turno |
| H4 | LLM disse “gravei” com tool falhando (`goalCanCommit` false) | Prompt diz para não mentir; não há gate na fala | Correlacionar tool result vs bolha |
| H5 | Histórico truncado (12 msgs LLM / 16 eager) perdeu o “aceito 257k” | Só importa se R$ estava só no chat e nunca no form | Dump do draft na sessão |

---

## E. Pontos de conflito (mesma verdade, várias mãos)

1. **`discussGoal` eager** vs **`draft_goal` hook** vs **`discussGoal` no `commit_draft`** — três entradas no mesmo rascunho.
2. **`form.target`** vs **`proposal.scenarios`** vs **texto do LLM** — três “valores recomendados”.
3. **`spokenReply` determinístico** vs **fala livre do LLM** vs **`naturalGoalAskFromDraft`**.
4. **`goalDraftRef` + sessionStorage** vs **`useState(goalDraft)=null`** — UI não espelha o operacional.
5. **`confirmedMount` (regex)** vs **`commit_draft` (decisão do modelo)** — autorização bipartida.
6. **Memória longa / chat / draft** — três memórias; “Apagar tudo” zera as três (pós-2026-10-30), mas durante o fio elas divergem.

---

## F. Riscos operacionais

| Risco | Severidade | Mecanismo |
|-------|------------|-----------|
| Gravar R$ diferente do anunciado | **Alta** | Fala sem mutação de `form.target` (C1) |
| Gravar sem o Gestor querer “salvar meta” | **Alta** | LLM chama `commit_draft` após qualquer “sim/vamos…” com checklist completo |
| Confirmar pesos interpretado como gravar | **Média-Alta** | Não há intent “só pesos”; modelo decide tool |
| Resposta desconectada (checklist) | **Alta** | Fallback C5 |
| Reexecução de cópia/cálculo no commit | **Média** | C3 |
| Números financeiros inventados na fala | **Alta** | Tools de análise não obrigatórias para o modelo “fazer conta” |

**Não há** validação “valor anunciado == valor persistido”.

---

## G. Plano de correção (proposta — **não implementado**)

### P0 — Contrato único de verdade

1. **Uma porta de mutação:** só `discussGoal` (ou só tools), nunca as duas com turnIds diferentes no commit.  
   Arquivos: `JarvisProvider.tsx`, `goalDraft.ts`.
2. **Separar `proposedTarget` de `acceptedTarget`:** LLM/motor propõem; só fala explícita do Gestor (ou botão) promove a `form.target`.  
   Arquivo: `goalDraft.ts`.
3. **Gate de commit:** `commit_draft` só se `pode_gravar_rascunho` **e** intent de gravação explícito (`salvar|gravar|autorizo rascunho`); “vamos deixar 45/55” não basta.  
   Arquivos: `JarvisProvider.tsx`, `goalDraft.ts`, tool schema em `jarvis-ai/index.ts` (schema, não “mais prompt”).
4. **Pós-commit / pré-fala:** se tool commit ok, a bolha de sucesso deve ser **determinística** com `form.target` lido do ref (não texto do modelo).

### P1 — Intenção e fala alinhadas ao estado

5. Ampliar detectors (`recomenda`, `como ficam`) **ou** classificador único de intent.  
6. Remover/condicionar `naturalGoalAskFromDraft` para não engolir correções de valor.  
7. Expor no painel o rascunho operacional (R$, níveis) — “o que será salvo”.

### P2 — Observabilidade e testes de estado

8. Log estruturado por turno: `turnId`, `lastUser`, `form.target` before/after, tools, `commit payload`.  
9. Testes de regressão **estado**, não só string: proposta → “recomenda” → níveis → “sim” → assert `commitGoal` target.  
10. Proibir conta financeira na fala sem bloco `sugestao_calculada` / snapshot no extras.

---

## H. Evidências por tópico pedido

### 1. Arquitetura / eager / tools / histórico / memória / save

| Tema | Onde |
|------|------|
| Entrada do chat | `JarvisProvider.reply` L592+ |
| Eager | L764–786: `discussGoal(historyBlob, {turnId})` |
| Skip LLM se `spokenReply` | L788–791 |
| LLM + tools | `llmClient.jarvisLlmTurn` L125+; Edge `jarvis-ai` |
| `draft_goal` usa `q` do Gestor, não o arg | L669–671 |
| Idempotência eager↔draft_goal | `discussGoal` L1485–1498 (`lastAppliedTurnId === turnId`) |
| Commit re-discuss | L717–718 `turnId-commit` |
| Persistência sessão draft | `persistGoalDraftSession` / `loadGoalDraftSession` |
| Memória | `memoryRepo.ts`; clear em `clearChat` L848+ |
| Save DB | `goalCommit.commitGoal` → `goalsRepo.saveGoal` (`target_cents`) |
| `goalCanCommit` | `confirmedGroups/Spread/Tiers/Mount` + form ready L99–107 |

### 2. Divergência 244.600 vs 257.000

| Achado | Tipo |
|--------|------|
| `form.target` só muda via parse R$ / `suggestGoalTarget` | **Confirmado** |
| “recomenda” pode não disparar sugestão | **Confirmado** (regex) |
| LLM pode falar R$ sem tool/mutação | **Confirmado** (arquitetura) |
| Commit usa `draft.form.target` do ref | **Confirmado** |
| Validação fala↔banco | **Ausente (confirmado)** |
| Exato path do caso de produção 257→244.6 | **Hipótese H1** (precisa log) |

### 3. Confirmações indevidas

| Achado | Tipo |
|--------|------|
| `looksLikeConfirmMount` = sim/pode/vamos criar/salvar rascunho | **Confirmado** L380–386 |
| “Vamos deixar 45 e 55” **não** casa esse regex | **Confirmado** |
| Mesmo assim LLM pode chamar `commit_draft` | **Confirmado** (tool livre) |
| Gravação real exige `goalCanCommit` | **Confirmado** |
| Fala “vou gravar” sem gravação possível | **Confirmado** (sem gate na UI de fala) |

### 4. Perda de contexto

| Achado | Tipo |
|--------|------|
| Fallback checklist substitui resposta | **Confirmado** C5 |
| `lastUser` tem prioridade para R$/mês no merge | **Confirmado** |
| `spokenReply`/inspect incompleto (“ficam”) | **Confirmado** C2 |
| history LLM sem mensagem atual no array base | **Confirmado** (corrigido ao montar messages no turn) |

### 5. Repetição / reexecução

| Chamada | Quando |
|---------|--------|
| `discussGoal` #1 | Eager, `turnId` |
| `discussGoal` #2 | `draft_goal` mesmo `turnId` → skip |
| `discussGoal` #3 | `commit_draft` com `turnId-commit` → **reaplica** |

### 6. Cálculos

| Peça | Comportamento real |
|------|-------------------|
| Base | Média YoY + recente (centavos) |
| Growth | YoY mês-a-mês ou hipótese +5% |
| Sazonal | `bias.factor` |
| Round | `roundHundred` |
| Níveis na fala determinística | `simulateLevelAtStoreTarget` / snapshot com `form.target` |
| Conta na prosa do LLM | **Sem amarração** |

### 7. Contratos das tools

| Tool | Params | Mutação app | Persistente | Validação |
|------|--------|-------------|-------------|-----------|
| `analyze_sales` | question | Não | Não | Brief |
| `analyze_goal` | question | Não | Não | Brief (metas **publicadas**, não o draft) |
| `analyze_stock` | question | Não | Não | — |
| `analyze_seasonal` | — | Não | Não | — |
| `draft_goal` | request (ignorado em favor de `q`) | Sim → `discussGoal` | sessionStorage | Regex interno |
| `draft_challenge/schedule` | request | Sim | state | — |
| `commit_draft` | target | Sim → discuss+`commitGoal` | **DB** | `goalCanCommit` / validate form |
| `discard_draft` | target | Sim | limpa ref/session | — |
| `remember_fact` / `forget_fact` | fact | Sim | `jarvis_memory` | tamanho |

**Não existe** tool “ler rascunho” separada: o estado vai no `contextNote` / retorno de `draft_goal`.

### 8. Persistência e divergência

| Store | Conteúdo | Recover |
|-------|----------|---------|
| React `goalDraft` | Quase sempre `null` | Não é fonte |
| `goalDraftRef` | Draft vivo | Sim, enquanto aba aberta |
| sessionStorage draft | JSON v1 | Refresh recupera; Apagar tudo limpa |
| Chat sessionStorage | Mensagens | Independente |
| `jarvis_memory` | Fatos | Apagar tudo limpa |
| `goal` table | Após commit | Rascunho `published_at` null |

### 9. Instrumentação e testes (recomendação — não implementar agora)

**Logs necessários por turno:**
- `turnId`, texto `lastUser`
- `form.target` / `userLockedTarget` / `proposal.recommended` before/after `discussGoal`
- `copyStatus`, `assembly`, `spokenReply?`
- tools: nome, args, resultado resumido
- commit: payload `target`, `tiers.length`, `groups`, id retornado

**Lacunas de teste:**
- Existem: `goalDraft.test.ts`, `goalConfigIntel.test.ts` (cópia, pesos, sessão).
- **Faltam:** e2e estado “recomenda → níveis → sim → assert save target”; commit sem intent de save; fala LLM ≠ form; `turnId-commit` não altera target.

---

## Conclusão (causa raiz estrutural)

Não é “só prompt”. O sistema tem **duas autoridades de discurso** (motor determinístico + LLM) e **uma autoridade de gravação** (`form` no ref), **sem contrato** que obrigue a fala a refletir o `form` nem que obrigue o commit a um intent inequívoco de salvar.

O ciclo de “ajustar prompt / spokenReply / regex” mascara sintomas; a correção estrutural é **uma fonte de verdade aceita pelo Gestor**, **mutação só com intent**, e **confirmação de gravação determinística a partir do estado**, não da prosa do modelo.

---

*Fim da auditoria. Nenhum arquivo de produto foi modificado nesta etapa; este relatório é o artefato solicitado.*
