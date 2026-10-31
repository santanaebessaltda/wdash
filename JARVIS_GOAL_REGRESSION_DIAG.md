# JARVIS — Diagnóstico de regressão (meta) e simplificação

**Data:** 2026-10-31  
**Escopo:** só diagnóstico + teste que falha. **Nenhuma correção de produto** nesta entrega.  
**Teste âncora:** `src/components/wedash/jarvis/goalConversation.regression.test.ts`

---

## 1. Causas confirmadas

### C1 — Escada 100/120/150/180 era o default residual do rascunho — **corrigido na Fase 2**

Antes: `emptyGoalForm` → `defaultGoalTiers()` = 100 / 120 / 150 / 180 já no aceite de valor.  
Agora: `emptyGoalForm.tiers = []` até path + confirmação/`copy` ok. `defaultGoalTiers` só no `fresh` após “serve a escada” (proposta explícita).

Evidência Fase 2: teste **A** → `tiers === []` após “Pode ser”; **L/M/N/O** cobrem copy/recommended/fresh.

### C2 — “Sim” após cópia zera `spokenReply` e marca `confirmedMount`

Sequência no motor (`discussGoal`):

1. Cópia ok → `confirmedGroups/Spread/Tiers = true`, `confirmedMount = false`, `spokenReply` = resumo da cópia.
2. Gestor: **“Sim”**.
3. `looksLikeConfirmMount("Sim")` → `confirmedMount = true`.
4. `resolveGoalValueDecision` ainda classifica stance = **`explicit_accept`** (afirmação natural).
5. Cascata de `spokenReply` **não** encontra ramo → **`spokenReply = null`**.
6. `JarvisProvider` não faz early-finish → **turno vai ao LLM**.

Evidência: teste **C** falha com  
`stance=explicit_accept; confirmedMount=true; path=copy: expected null to be truthy`.

Isso explica os passos 8–12: o modelo “pede de novo” o R$ 500.000 / tenta avançar gravação **sem** a fala determinística da config copiada.

No turno seguinte, com `prev.assembly.confirmedMount === true` + `looksLikeConfirmPendingSave`, o ramo 2 (~2716–2737) pode **autorizar commit** sem `pendingCommit.awaitingConfirm` apresentado — alinhado ao “tentou salvar sem demonstrar a configuração”.

### C3 — Perguntas consultivas sobre níveis não entram em inspeção

`looksLikeInspectGoalDraft("Tem quatro níveis?")` → **false**.

Sem match → sem `speakGoalDraftConfig` → `spokenReply` vazio → LLM inventa escada (pode misturar default 100–180 com 50/110 → “cinco níveis inconsistentes”).

Evidência: teste **E** falha em `expected false to be true` no classificador.  
Contraste: **“Quais são os níveis?”** casa o regex e o teste **F** passa com 50/75/100/110.

### C4 — A cópia estrutural, com origem no banco, funciona

Com fixture controlada (mesma filial, 4 níveis 50/75/100/110, grupos 45/55):

- `copyGoalLadderFromPeriod` → `copyStatus=ok`
- `copiedFrom.goalId` / `storeId` corretos
- tiers, comissões, bônus, grupos e `tierMode` batem com a origem
- fala pós-cópia lista 50–110 e **não** 120/150/180

Evidência: teste **B** verde.  
Logo: o bug da conversa real **não** é “o motor não sabe copiar”; é (a) default residual antes da cópia, (b) buraco de fala após “Sim”, (c) inspeção consultiva fraca, (d) possível origem real ≠ 4 níveis ou cópia falha silenciosa no ambiente.

### C5 — Sobreposição de classificadores no mesmo “Sim”

Na mesma utterance “Sim” / “Pode ser” podem acender:

| Classificador | Efeito possível |
|---|---|
| `looksLikeNaturalAffirmation` / `GoalValueStance=explicit_accept` | Aceite de `proposedTarget` |
| `looksLikeConfirmPendingSave` | Autorizar `pendingCommit` |
| `looksLikeBareCopyAccept` | Executar cópia (se path=copy pendente) |
| `looksLikeConfirmMount` | `confirmedMount=true` |
| `looksLikeConfirmTiers` | Confirma escada recommended |
| `interpretGoalOpStructural` `confirmation` | Plano P1 |

Gates de estado escolhem o efeito, mas **não garantem fala determinística** depois — daí o LLM contradizer o estado.

---

## 2. Hipóteses ainda não comprovadas

| ID | Hipótese | Como comprovar |
|---|---|---|
| H1 | Na loja real, a meta de outubro **não** tem 4 níveis (só 50/110) | Query `goal` outubro da filial no Supabase; comparar `tiers` JSON |
| H2 | Cópia falhou (`copy_miss`) e o LLM afirmou sucesso | Logs `[jarvis.goal] copy_miss` / `copy_ok` no turno |
| H3 | `applyChallengeTierPct(..., 110)` colapsou escada pós-cópia por fala com “desafio/10%” | Replay do transcript completo no `discussGoal` |
| H4 | Caminho **recommended** ou **fresh** rodou entre aceite e cópia e reescreveu tiers | Trace `assembly.path` por turno |
| H5 | `interpret_goal_op` divergiu do estrutural e `opPlan.spokenReply` falou níveis errados | Diff intent LLM vs estrutural no mesmo turno |
| H6 | Histórico no blob reaplicou mês/valor (só `mergeGoalUtterance` usa blob completo se `startsOn` vazio) | Caso com período ainda nulo |

---

## 3. Sequência exata em que a configuração diverge

```
[estado inicial do rascunho]
  tiers = [] (Fase 2)                 ← sem escada até path + confirmação/cópia

T5  "Pode ser"
  → form.target = 500000, path=null
  → spokenReply = oferta de caminho (componente)
  → tiers AINDA default                     ← passo 6 se alguém recita tiers

T7  "Copie a configuração de outubro"
  → (se DB ok) tiers = 50/75/100/110, copyStatus=ok
  → spokenReply = resumo da cópia           ← ponto saudável

T9  "Sim"
  → confirmedMount = true
  → spokenReply = null                      ← DIVERGÊNCIA DE CONTROLE
  → LLM assume o turno                      ← pode reabrir valor / inventar save

T11 "R$ 500.000"
  → (motor) target permanece; tiers ok se cópia ok
  → se LLM no meio, narrativa ≠ estado

T13 "Quais são os níveis?"
  → inspeção OK → fala = rascunho

T15 "Tem quatro níveis?"
  → NÃO é inspeção → spokenReply null     ← DIVERGÊNCIA DE FALA
  → LLM pode misturar escadas             ← passo 16
```

**Divergência estrutural** (tiers errados no `form`): só ocorre se a cópia falhar, outro caminho sobrescrever, ou `applyChallengeTierPct` colapsar — **não** no happy path do teste com fixture.  
**Divergência perceptiva** (Gestor vê escada errada): default residual + LLM com `spokenReply` vazio.

---

## 4. Evidências de código e logs

| Peça | Onde |
|---|---|
| Default 100–180 | `defaultGoalTiers` só no fresh confirmado; `emptyGoalForm.tiers=[]` (Fase 2) |
| Pipeline eager → spokenReply → LLM | `JarvisProvider.tsx` ~903–950 |
| Cópia | `copyGoalLadderFromPeriod` ~974–1070; seleção ~2182–2338 |
| “Sim” → mount | `looksLikeConfirmMount` + bloco ~2612–2625 |
| Commit sem pending apresentado | ramo 2 ~2716–2737 |
| Cascata spokenReply | ~2845–2995 |
| Inspeção | `looksLikeInspectGoalDraft` ~316–327 |
| Logs de cópia | `logGoalCopy("copy_ok"|"copy_miss"|"turn_state")` — stdout nos testes |
| Prompt Edge | `supabase/functions/jarvis-ai/index.ts` SYSTEM_PROMPT (proíbe inventar, mas só vale se o LLM rodar) |

Logs observados no teste (cópia ok):

```
[jarvis.goal] copy_ok { sourceGoalId: 'goal-oct-4tiers', tiers: 4, groups: 2, target: 500000, ... }
[jarvis.goal] turn_state { copyStatus: 'ok', path: 'copy', tiers: 4, ... }
```

---

## 5. Resultado do teste de regressão

Arquivo: `goalConversation.regression.test.ts`  
Comando: `npx vitest run src/components/wedash/jarvis/goalConversation.regression.test.ts`

| Caso | Resultado | Significado |
|---|---|---|
| **A** aceite “Pode ser” | PASS | Default 100–180 permanece (explica passo 6) |
| **B** cópia outubro fixture | PASS | Motor de cópia fiel com 4 níveis |
| **C** “Sim” pós-cópia | **FAIL** | `spokenReply=null`, `confirmedMount=true`, stance=explicit_accept |
| **D** reafirma R$ 500 mil | PASS | Não destrói escada no motor |
| **E** “Tem quatro níveis?” | **FAIL** | Não classifica como inspeção |
| **F** “Quais são os níveis?” | PASS | Inspeção explícita lê o rascunho |

**2 falhas / 4 passes** — o bug está reproduzido sem alterar o produto.

---

## 6. Mapa de sobreposição (mecanismos concorrentes)

```
                    ┌─────────────────────┐
   fala do Gestor → │ interpret_goal_op   │──┐
                    │ (LLM + estrutural)  │  │
                    └─────────────────────┘  │
                    ┌─────────────────────┐  │   ┌──────────────────┐
                    │ GoalValueStance     │──┼──►│ discussGoal      │
                    │ resolveGoalValue…   │  │   │ (ÚNICA mutação)  │
                    └─────────────────────┘  │   └────────┬─────────┘
                    ┌─────────────────────┐  │            │
                    │ parseGoalAssembly…  │──┘            ▼
                    │ copy / mount / save │        draft + spokenReply?
                    │ regex checklist     │            │
                    └─────────────────────┘     sim ───┴─── não
                                                 │           │
                                          finish(speak)   jarvisLlmTurn
                                                              │
                                                         draft_goal (noop
                                                         se mesmo turnId)
                                                              │
                                                         prosa LLM
                                                         (pode mentir)
```

Responsabilidades sobrepostas hoje:

1. **Intenção de afirmação** — Stance + confirm save + confirm mount + bare copy + opIntent confirmation.  
2. **Fala pós-operação** — cascata enorme em `discussGoal` **e** SYSTEM_PROMPT **e** safety nets no Provider.  
3. **Escada** — default editor + cópia DB + recommended history + `applyChallengeTierPct` + prosa LLM.

---

## 7. Proposta de simplificação (sem reescrever tudo)

### Princípio

- **LLM:** intenção + prosa de consultoria.  
- **Operações:** funções puras/async tipadas (`acceptValue`, `copyConfig`, `offerSave`, `confirmSave`).  
- **Estado:** `GoalDraft` = fonte de verdade; UI/fala de operação **só** a partir do retorno da operação.  
- **Commit:** exclusivamente `pendingCommit.authorized` da versão fingerprintada.

### Permanecer

| Símbolo | Motivo |
|---|---|
| `GoalDraft` + `assembly` + `pendingCommit` + fingerprint | Contrato P0 de gravação |
| `copyGoalLadderFromPeriod` | Já é determinístico e testável |
| `suggestGoalTarget` / evidências | Cálculo financeiro |
| `buildGoalConfigSnapshot` / `speakGoalDraftConfig` | Fala ancorada no estado |
| `JarvisProvider` eager `discussGoal` + early-finish | Evita LLM mutando |
| Idempotência `turnId` | Evita double-apply |

### Consolidar

| De | Para |
|---|---|
| Dezenas de `looksLike*` de afirmação | Um `AffirmationRole` resolvido **depois** do estado (`accept_value` \| `confirm_copy_mount` \| `confirm_save` \| `none`) |
| Cascata `spokenReply` 15+ ramos | `speakForTurn(opResult)` switch no resultado da operação |
| `interpret_goal_op` + stance + parse path em paralelo | Pipeline fixo: `classifyTurn(state, text) → Operation → apply → speak` |
| Safety nets Provider (premature save, unfinished analysis, stalling) | Só para **não-meta** / rede; meta = só `opResult.speech` |

### Remover ou redesenhar (gradual)

| Item | Ação | Risco se remover cedo |
|---|---|---|
| Ramo commit 2 (Sim sem pending apresentado) | Remover | Médio — pode ter salvado conversas “LLM pediu confirmação sozinho” |
| `defaultGoalTiers` no rascunho antes do path | Redesenhar: `tiers: []` até copy/recommended/fresh | Médio — UI/editor assume 4 níveis |
| Regex de inspeção isoladas | Redesenhar: intent `inspect_draft` no classificador de turno | Baixo |
| `applyChallengeTierPct` automático pós-cópia | Só com operação explícita `adjust_challenge_pct` | Médio |
| SYSTEM_PROMPT longamente prescritivo sobre meta | Encolher: “não invente tiers; use ESTADO_OPERACIONAL” | Baixo se estado sempre no contextNote |
| Double path LLM `draft_goal` no fio com spokenReply | Manter noop; eventualmente não oferecer tool se `opResult.done` | Baixo |

### Arquitetura alvo (incremental)

```
classifyTurn(prev, text) → GoalTurnIntent
applyGoalTurn(prev, intent, tools) → { draft, op, speech }
Provider: sync(draft); finish(speech) | LLM(consultativeOnly)
commitGoal: só se draft.pendingCommit.authorized && fingerprint match
```

---

## 8. Riscos de migração

| Risco | Mitigação |
|---|---|
| Quebrar “Sim” que hoje salva via ramo 2 | Feature flag + testes de `pendingCommit` obrigatório |
| Rascunho com `tiers: []` quebrar editor/card | Aceitar só após path; card desabilitado sem path |
| Conversas longas dependentes do LLM narrar checklist | Mais `speech` determinística nos intents consultivos |
| `interpret_goal_op` ainda necessário para R$ em nível | Manter como input do classificador, não como mutador |
| Testes unitários acoplados a regex | Migrar asserts para `GoalTurnIntent` |

---

## 9. Plano incremental (sem big-bang)

### Fase 0 — já entregue aqui

- [x] Mapa do fluxo  
- [x] Teste de regressão vermelho (A–F)  
- [x] Este relatório  

### Fase 1 — fechar o buraco de controle (baixo risco) — **FEITA 2026-10-31**

1. Pós-cópia, “Sim”/`Pode` → `acknowledge_copy` com `speakGoalDraftConfig` (nunca `spokenReply` null).  
2. “Sim” genérico **não** marca `confirmedMount`.  
3. Removido ramo 2 de commit sem pending; só `confirm_save` com fingerprint.  
4. Inspeção ampliada no mesmo `looksLikeInspectGoalDraft` + `resolveGoalAffirmationRole` por estado.  
5. Oferta ambígua → `clarify_choice`.  

**Gate:** C e E verdes; A/B/D/F + G–K no `goalConversation.regression.test.ts`.

### Fase 2 — estado limpo de escada — **FEITA 2026-10-31**

1. `emptyGoalForm.tiers = []`; aceite de valor não cria escada.  
2. Fresh: propõe `defaultGoalTiers` na fala; só aplica no form após `looksLikeConfirmTiers`.  
3. Recommended: padrão do histórico com `confirmedTiers=false` até aceite.  
4. Copy: só níveis da origem; falha → `copyStatus=failed`, tiers vazios (sem fallback).  
5. `correctingCopy` não dispara em path `fresh`/`recommended` (evita “divisão por grupos” puxar outubro).  
6. `validateGoalDraft` exige tiers p/ gravar; `goalDraftCoreReady` p/ montagem.

**Gate:** regressão A–O verdes; suite jarvis verde; editor mantém `DEFAULT_TIERS` próprio.

### Fase 3 — unificar afirmações — **FEITA 2026-10-31**

1. `classifyTurn` / `classifyGoalTurn` → `GoalTurnIntent` (uma intenção/turno; não muta).  
2. `discussGoal` consome `turnIntent` para valor / path / afirmação / save.  
3. `GoalValueStance` só via decisão de valor; `looksLikeConfirmMount` deprecated (não muta).  
4. Cópia semântica via `GoalOpIntent` (origem) anexada ao `select_path` — sem regex isolada nova no detector de path.  
5. Frase composta (copiar + R$) = `select_path` com `value` anexado.

**Gate:** suite jarvis 243 verdes; `goalTurnIntent.test.ts` + regressão A–O.

### Fase 4 — LLM consultivo — **FEITA 2026-10-31**

1. `applyGoalTurn` → `GoalTurnResult` (intent, operation, status, speech, allowLlm, facts).  
2. Provider: `speech && !allowLlm` → finish sem chat; consultiva → LLM com ESTADO.  
3. `draft_goal` = alias idempotente de `applyGoalTurn` (mesmo `turnId`).  
4. `interpret_goal_op` só alimenta classificação; não muta.  
5. SYSTEM_PROMPT de meta enxuto (sem checklist obrigatório no fim de cada fala).

**Gate:** suite jarvis 255 verdes; `goalTurnApply.test.ts` + regressão A–O + Fase 3.

### Fase 5 — observabilidade / validação — **FEITA 2026-10-31**

1. `goalTurnTrace.ts`: `GoalTurnTrace` + sink (`emitGoalTurnTrace`) sem PII/mensagens/tokens.  
2. Invariantes: cópia falsa · save falso · consulta mutando · tiers sem intent · commit sem pending · reexec · residual 120/150/180 · LLM após mutação (log).  
3. `applyGoalTurn` emite trace + timings; violação → fala segura (`speakInvariantSafe`).  
4. Probe read-only `scripts/probe-october-goal.mjs` — outubro real `minPct` 50/75/100/110 (≠ fixture GROUP; banco usa `minPct`/`bonusCents`, mapeados em `goalFromRow`).  
5. Integração: `goalIntegration.fase5.test.ts`.

**Gate:** suite jarvis 264 verdes.

---

## 10. Checklist de investigação de cópia (ambiente real)

Para o próximo teste com dados reais (não feito aqui — sem acesso ao tenant):

1. `fetchGoals` outubro da mesma `store_id` — contar `tiers.length` e percentuais.  
2. Conferir se meta está publicada ou só rascunho (`includeDrafts`).  
3. Log `copy_ok` vs `copy_miss` no turno “copiar outubro”.  
4. Diff `form.tiers` before/after no mesmo `turnId`.  
5. Se `ok` e depois tiers ≠ origem → procurar `selectingRecommended`, `selectingFresh`, `applyChallengeTierPct` no mesmo ou próximo turno.

---

## 11. Conclusão

O fluxo **não** falha principalmente por “não saber copiar”. Com origem correta, a cópia é fiel.

As regressões recorrentes vêm de **arquitetura de controle**:

1. Estado default de escada antes do caminho.  
2. Afirmações curtas ambíguas (`Sim`) com vários efeitos e **sem fala âncora**.  
3. LLM preenchendo buracos de `spokenReply` e contradizendo o rascunho.  
4. Inspeção consultiva incompleta.

Prioridade: **fechar o circuito operação → estado → fala** antes de novas features ou mais regras no prompt.
