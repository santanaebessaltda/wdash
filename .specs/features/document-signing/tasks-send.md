# Envio com destinatários — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/document-signing/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: none - strong defaults applied. Existing tests are Vitest colocated as `src/**/*.test.ts`. Commands from `package.json`: `test` = `vitest run`, `lint` = `oxlint`, `build` = `tsc -b && vite build`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain rules | unit | All branches; 1:1 to the send-flow decisions; listed edge cases | `src/data/wedash/documentSplit.test.ts` | `npx vitest run src/data/wedash/documentSplit.test.ts` |
| Edge function | none | Build gate. The HTTP shell calls the domain rules already tested. | `supabase/functions/documents/index.ts` | `npm run build` |
| Schema | none | Build gate only | `supabase/migrations/*.sql` | `npm run build` |
| Screen | none | Build gate. Behavior comes from the domain rules. | `src/pages/documents/AttachWizard.tsx` | `npm run build` |

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
T1 -> T2
T1 -> T3
```

### Phase 2: Envelope

```
T1 -> T4
T2 -> T4
```

### Phase 3: Wizard

```
T1 -> T5
T5 -> T6
T4 -> T7
T6 -> T7
```

---

## Task Breakdown

### T1: Decide which contact fields and marks go out

**What**: Pure rules for a filled profile, per-document channel, replicate, the default signature mark, and the envelope recipients.
**Where**: `src/data/wedash/documentSplit.ts`
**Depends on**: None
**Reuses**: `saveCpf`, `saveEmail`, `saveWhatsapp`, `channelBlock`
**Requirement**: Canal, Replicar, Assinatura, Signatário extra

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [x] A profile that already has CPF and the channel contact asks for no fields
- [x] WhatsApp hides e-mail; e-mail hides WhatsApp; CPF appears only when missing
- [x] Replicate copies channel and marks and does not copy CPF, e-mail, or WhatsApp
- [x] The default mark is `SIGNATURE` at x 50 y 50 on the last page
- [x] The envelope lists the collaborator at routingOrder 1 and the extra signer at routingOrder 2, both with action SIGN and authentication DEFAULT_SIGN
- [x] A blank extra signer is omitted
- [x] Gate check passes: `npx vitest run src/data/wedash/documentSplit.test.ts`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(documents): decide contact fields and signature marks`

---

### T2: Store the channel, the marks, and the extra signer

**What**: Add `employee_document.channel`, `employee_document.marks`, and `document_batch.extra_signer`.
**Where**: `supabase/migrations/20261015130000_document_send_setup.sql`
**Depends on**: T1
**Reuses**: `supabase/migrations/20261014180000_documents.sql`
**Requirement**: Canal, Assinatura, Signatário extra

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [x] The migration adds the three columns without rewriting existing rows
- [x] `document_batch.channel` stays in place and is no longer required for send
- [x] Gate check passes: `npm run lint` and `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): store per-document channel and marks`

---

### T3: Save only the contact fields that were shown

**What**: `save-contact` updates only the keys it receives, so a hidden e-mail is not wiped and a missing CPF is not required when it was not asked.
**Where**: `supabase/functions/documents/index.ts`
**Depends on**: T1
**Reuses**: `contactPatch` from `documentSplit.ts`
**Requirement**: Canal

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [x] A WhatsApp-only patch writes `whatsapp` and leaves `email` and `cpf` untouched
- [x] An invalid CPF still returns the existing bad-CPF message
- [x] Gate check passes: `npm run lint` and `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `fix(documents): save only the contact fields on screen`

---

### T4: Create the envelope from the stored setup

**What**: `confirm` reads each document channel and marks, plus the batch extra signer, and stops stamping every page.
**Where**: `supabase/functions/documents/index.ts`
**Depends on**: T1, T2
**Reuses**: `envelopeSignatures` from `documentSplit.ts`
**Requirement**: Canal, Assinatura, Signatário extra

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [x] Each document sends with its own channel
- [x] Marks are the stored ones, not the center of every page
- [x] `recipient_id` stored is the collaborator, routingOrder 1
- [x] A row that already has an envelope is skipped
- [x] Gate check passes: `npm run lint` and `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): send each file on its own channel`

---

### T5: Ask for contact only when the profile is missing it

**What**: Replace the batch channel step with Destinatários. Show CPF, e-mail, or WhatsApp only when that value is missing. Replicate copies the channel to the checked collaborators.
**Where**: `src/pages/documents/AttachWizard.tsx`
**Depends on**: T1
**Reuses**: `contactFieldsToAsk`, `replicateSetup`, `FormField`, `WizardSteps`
**Requirement**: Canal, Replicar

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [x] A complete profile shows the name and the channel and no contact fields
- [x] Filling a missing field saves it and the field does not come back
- [x] Deadline and reminder stay once for the batch
- [x] The extra signer form is optional and shared by the batch
- [x] Gate check passes: `npm run lint` and `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): ask for a contact only once`

---

### T6: Place the signature on the sample PDF

**What**: Add the Assinaturas step. Render one page, drag the signature mark, and replicate those marks to the checked collaborators.
**Where**: `src/pages/documents/SignaturePlacement.tsx`
**Depends on**: T5
**Reuses**: `defaultSignatureMark`, `replicateSetup`
**Requirement**: Assinatura, Replicar

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [x] The mark starts at the center of the last page
- [x] Dragging updates x and y as percentages
- [x] Replicate copies marks and does not copy the person's contact
- [x] Rubrica is not sent
- [x] Gate check passes: `npm run lint` and `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): place the signature on the sample page`

---

### T7: Review the batch and send

**What**: Make Revisão read-only: person, channel, and signature page. Send uses the stored setup.
**Where**: `src/pages/documents/AttachWizard.tsx`
**Depends on**: T4, T6
**Reuses**: `sendReady`, the existing confirm call
**Requirement**: Canal, Assinatura

**Tools**:

- MCP: NONE
- Skill: tlc-spec-driven

**Done when**:

- [ ] Revisão does not edit CPF, e-mail, or WhatsApp
- [ ] Each row shows the channel and the signature page
- [ ] The extra signer is shown once above the list
- [ ] Send skips a row that already has an envelope
- [ ] Gate check passes: `npm run lint` and `npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(documents): review who receives each file`

---

## Phase Execution Map

```
T1 -> T2
T1 -> T3
T1 -> T4
T2 -> T4
T1 -> T5
T5 -> T6
T4 -> T7
T6 -> T7
```
