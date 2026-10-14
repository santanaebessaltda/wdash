# Assinatura de documentos — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/document-signing/design.md`
**Status**: Done

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: none - strong defaults applied. Existing tests are Vitest colocated as `src/**/*.test.ts`. Commands from `package.json`: `test` = `vitest run`, `lint` = `oxlint`, `build` = `tsc -b && vite build`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain rules | unit | All branches; 1:1 to spec ACs that are pure rules; listed edge cases | `src/data/wedash/*.test.ts` | `npx vitest run src/data/wedash/documentSplit.test.ts` |
| Edge function | none | Build gate. The HTTP shell calls the domain rules already tested. | `supabase/functions/**` | `npm run build` |
| Schema | none | Build gate only | `supabase/migrations/*.sql` | `npm run build` |
| Screen | none | Build gate. Behavior comes from the domain rules. | `src/pages/documents/**` | `npm run build` |

## Gate Check Commands

> Generated from codebase.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After the domain-rule task | `npx vitest run src/data/wedash/documentSplit.test.ts` |
| Full | Same as quick. This repo has no e2e runner. | `npx vitest run src/data/wedash/documentSplit.test.ts` |
| Build | After schema, function, or screen tasks | `npm run lint` and `npm run build` |

---

## Execution Plan

### Phase 1: Rules and storage

```
T1 → T2
T1 → T3
```

### Phase 2: Assina AI and the screen

```
T2 → T4
T3 → T4
T4 → T5
T4 → T6
T5 → T7
T6 → T7
```

---

## Task Breakdown

### Phase 1: Rules and storage

### T1: Document split rules

**What**: CPF, grouping, file name, folder, batch status, and the exact refusal messages.
**Where**: `src/data/wedash/documentSplit.ts`
**Depends on**: None
**Reuses**: `src/data/wedash/shoppingReport.test.ts`
**Requirement**: DOCS-01, DOCS-02, DOCS-04, DOCS-05, DOCS-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Valid CPF stores 11 digits and a bad check digit returns "CPF inválido."
- [x] Unify groups pages by CPF. Unify off keeps one page per group.
- [x] Batch is Assinado only when every document is Assinado.
- [x] Gate check passes: `npx vitest run src/data/wedash/documentSplit.test.ts`
- [x] Test count: 20 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(documents): add split and status rules`

---

### T2: Document tables

**What**: CPF on the employee, batch and document tables, private bucket, owner-only read.
**Where**: `supabase/migrations/20261014180000_documents.sql`
**Depends on**: T1
**Reuses**: `supabase/migrations/20260927140000_identity_avatar.sql`
**Requirement**: DOCS-01, DOCS-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `store_seller.cpf` exists and the seller sync payload does not write it
- [x] Authenticated users can select documents of their tenant and cannot write them
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): store batches and signed files`

---

### T3: Assina AI credential

**What**: One encrypted token per company, tested before save, and the Integrações card.
**Where**: `supabase/functions/assina-credential-persist/index.ts`
**Depends on**: T1
**Reuses**: `supabase/functions/shopping-credential-persist/index.ts`
**Requirement**: DOCS-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A rejected token is not stored and the response is "Token inválido."
- [x] The card uses `/assinaai.png` and does not show the token again
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): connect Assina AI for the company`

---

### Phase 2: Assina AI and the screen

### T4: Prepare and send

**What**: Split uploaded PDFs, hold pages without an owner, and create one envelope per ready file.
**Where**: `supabase/functions/documents/index.ts`
**Depends on**: T2, T3
**Reuses**: `src/data/wedash/documentSplit.ts`
**Requirement**: DOCS-02, DOCS-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Confirm skips a row that already has an envelope
- [x] A missing token, deadline, contact, or file over 5 MB does not call create
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): split PDFs and create envelopes`

---

### T5: Webhook

**What**: Wake on Assina AI events, read the envelope with the company token, and store the signed PDF.
**Where**: `supabase/functions/assina-webhook/index.ts`
**Depends on**: T4
**Reuses**: `supabase/functions/documents/index.ts`
**Requirement**: DOCS-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A repeated event id does not change the row
- [x] An unknown envelope is ignored
- [x] Assinado does not move backward
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): store the signed PDF from Assina AI`

---

### T6: Document screen

**What**: Folders, batch progress, review, and resend for the Gestor.
**Where**: `src/pages/documents/DocumentsPage.tsx`
**Depends on**: T4
**Reuses**: `src/components/ui/ProgressBar.tsx`
**Requirement**: DOCS-04, DOCS-05, DOCS-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] One store opens at the employee. All stores open at the store.
- [x] The batch bar is signed count over document count
- [x] Resend is hidden unless the row is Pendente
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): show folders and batch progress`

---

### T7: Menu entry

**What**: Documentos on the Gestor menu at `/documents`, hidden from Gerente and Vendedor.
**Where**: `src/layout/nav-wedash.ts`
**Depends on**: T5, T6
**Reuses**: `src/layout/nav-wedash.ts`
**Requirement**: DOCS-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The item is outside Gestão and outside Configurações
- [x] Gerente and Vendedor do not see it
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): add the Gestor menu entry`

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1 → T2
Phase 1:  T1 → T3
Phase 2:  T4 → T5
Phase 2:  T4 → T6
Phase 2:  T5 → T7
Phase 2:  T6 → T7
```

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Document split rules | 1 module | Granular |
| T2: Document tables | 1 migration | Granular |
| T3: Assina AI credential | 1 function | Granular |
| T4: Prepare and send | 1 function | Granular |
| T5: Webhook | 1 function | Granular |
| T6: Document screen | 1 page | Granular |
| T7: Menu entry | 1 nav change | Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | no incoming arrow | Match |
| T2 | T1 | T1 → T2 | Match |
| T3 | T1 | T1 → T3 | Match |
| T4 | T2, T3 | T2 → T4 and T3 → T4 | Match |
| T5 | T4 | T4 → T5 | Match |
| T6 | T4 | T4 → T6 | Match |
| T7 | T5, T6 | T5 → T7 and T6 → T7 | Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Domain rules | unit | unit | OK |
| T2 | Schema | none | none | OK |
| T3 | Edge function | none | none | OK |
| T4 | Edge function | none | none | OK |
| T5 | Edge function | none | none | OK |
| T6 | Screen | none | none | OK |
| T7 | Screen wiring | none | none | OK |
