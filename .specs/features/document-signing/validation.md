# document-signing Validation

**Date**: 2026-10-14
**Spec**: `.specs/features/document-signing/spec.md`
**Diff range**: `3c9c0ac..0e9629d` (local `main`, not pushed)
**Verifier**: independent sub-agent (author ≠ verifier)
**Result**: PASS

Re-verify after `0e9629d` `fix(documents): unify shared CPFs and survive a failed send`. Schema, edge functions, and the screen have no unit tests in the approved matrix. Those cells are **Build gate** when the implementation line does what the spec says. **PASS** means a unit assertion matches the spec outcome. The working tree still has unrelated shopping edits. They were not modified, staged, stashed, or committed.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | 20 unit tests. Includes the eight categories and one CPF across two source indexes. |
| T2 | ✅ Done | Schema. Build gate. Seller sync payloads omit `cpf`. |
| T3 | ✅ Done | Credential function. Build gate. A rejected token returns before upsert. |
| T4 | ✅ Done | Pages are grouped after every accepted source. A thrown create writes the row error and the loop continues. |
| T5 | ✅ Done | A thrown signed-file download still updates status and does not store the temporary URL. |
| T6 | ✅ Done | Screen. Build gate. |
| T7 | ✅ Done | Gestor menu. Build gate. |

---

## Spec-Anchored Acceptance Criteria

### P1: Cadastro para achar o destinatário (DOCS-01)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN the Gestor saves a store employee THEN the system SHALL store CPF, e-mail and WhatsApp on that `store_seller` | 11-digit CPF plus e-mail and WhatsApp written on `store_seller` | `supabase/functions/documents/index.ts:251` - `update({ cpf: cpf.cpf, email: email.email, whatsapp: whatsapp.whatsapp })`. Normalizer asserted at `documentSplit.test.ts:30` - `expect(saveCpf(VALID)).toEqual({ ok: true, cpf: VALID_DIGITS })` | ✅ Build gate |
| IF the CPF does not have 11 digits or the check digits fail THEN reject and show "CPF inválido." | `{ ok: false, message: "CPF inválido." }` | `documentSplit.test.ts:35` - `expect(saveCpf("529.982.247-26")).toEqual({ ok: false, message: DOCUMENT_COPY.badCpf })`; `:36` - `expect(saveCpf("123")).toEqual({ ok: false, message: "CPF inválido." })`. Guard: `documents/index.ts:245` | ✅ PASS |
| IF the WhatsApp does not have 10 or 11 digits THEN reject and show "WhatsApp inválido." | `{ ok: false, message: "WhatsApp inválido." }` | `documentSplit.test.ts:48` - `expect(saveWhatsapp("123")).toEqual({ ok: false, message: "WhatsApp inválido." })` | ✅ PASS |
| IF the e-mail has no @ THEN reject and show "E-mail inválido." | `{ ok: false, message: "E-mail inválido." }` | `documentSplit.test.ts:56` - `expect(saveEmail("ana-loja.com")).toEqual({ ok: false, message: "E-mail inválido." })` | ✅ PASS |
| The system SHALL keep an empty e-mail and an empty WhatsApp when cleared | empty input stored as null | `documentSplit.test.ts:44` - `expect(saveWhatsapp("  ")).toEqual({ ok: true, whatsapp: null })`; `:54` - `expect(saveEmail("")).toEqual({ ok: true, email: null })` | ✅ PASS |

### P1: Cortar o PDF e revisar (DOCS-02)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN the Gestor adds PDFs with month, year and one category THEN read each page's text and group by CPF | Text per page, then one group per CPF | Read: `supabase/functions/_shared/pdfPages.ts:5` `extractText`, called at `documents/index.ts:154`. Group: `documentSplit.test.ts:85` - `expect(groupPages(pages, true)).toEqual([...])` | ✅ PASS |
| The system SHALL accept only the eight named categories | Those eight names, in that list | `documentSplit.test.ts:63` - `expect([...DOCUMENT_CATEGORIES]).toEqual(["Holerite", "Espelho de ponto", "Adiantamento salarial", "Vale transporte", "Vale alimentação / refeição", "Participação nos lucros (PLR)", "Informe de rendimentos", "Outros"])`. Reject others: `documents/index.ts:90` | ✅ PASS |
| WHILE unify is on, one PDF per matched CPF with every page of that CPF in the batch | One group holding both source indexes | `documentSplit.test.ts:98` - `expect(groupPages([{ sourceIndex: 0, ... }, { sourceIndex: 1, pageNumber: 3, ... }], true)).toEqual([{ cpf, pages: [source 0 page 1, source 1 page 3] }])`. Wiring: `documents/index.ts:174` flattens every accepted file, then `:175` `groupPages`, then `:186` `buildPdf(sourceBytes, group.pages)` | ✅ PASS |
| WHEN unify is off THEN one PDF per page | Each page is its own group | `documentSplit.test.ts:120` - `expect(groups).toHaveLength(2)`; `:121` - `expect(groups.every((group) => group.pages.length === 1)).toBe(true)` | ✅ PASS |
| WHEN exactly one employee in the current store scope has that CPF THEN assign that employee | The single match's id | `documentSplit.test.ts:132` - `expect(assignSeller([{ id: "ana" }])).toBe("ana")`. Scope: `documents/index.ts:129` | ✅ PASS |
| IF no CPF, nobody, or more than one employee THEN leave the page unassigned and do not create an envelope | `sellerId` null and `shouldSend` false | `documentSplit.test.ts:136` - `expect(assignSeller([])).toBeNull()`; `:137` - two ids `toBeNull()`; `:201` - `expect(shouldSend({ envelopeId: null, sellerId: null, block: null })).toBe(false)` | ✅ PASS |
| IF a file has no extractable text THEN refuse it and show the scanned-file sentence | "Arquivo escaneado não é aceito. Envie o PDF gerado pelo sistema de folha." | `documentSplit.test.ts:184` - `expect(sourceRefusal({ ...ok, hasText: false })).toBe(DOCUMENT_COPY.scanned)` | ✅ PASS |
| IF the batch already has 5 PDFs THEN refuse another and show "O lote aceita até 5 PDFs." | that sentence | `documentSplit.test.ts:181` - `expect(sourceRefusal({ ...ok, alreadyAccepted: 5 })).toBe("O lote aceita até 5 PDFs.")` | ✅ PASS |
| IF a source PDF is over 15 MB or over 1000 pages THEN refuse it and show "Cada PDF de origem aceita até 15 MB e 1.000 páginas." | that sentence | `documentSplit.test.ts:182` - `bytes: 15 * 1024 * 1024 + 1`; `:183` - `pages: 1001` | ✅ PASS |
| IF the file is not a PDF THEN refuse it and show "Envie apenas PDF." | that sentence | `documentSplit.test.ts:180` - `expect(sourceRefusal({ ...ok, mime: "image/png" })).toBe("Envie apenas PDF.")` | ✅ PASS |
| WHEN the Gestor picks an employee for an unassigned page THEN assign it and keep it unsent | `seller_id` set, no `envelope_id` | `documents/index.ts:237` - `update({ seller_id: sellerId, store_id: seller.store_id, error: null })` | ✅ Build gate |
| IF month, year or category is missing THEN the system SHALL NOT split | 400 before prepare | `documents/index.ts:90` returns `invalid_batch` | ✅ Build gate |

### P1: Disparar pelo Assina AI (DOCS-03)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN the Gestor confirms with channel, deadline and reminder THEN create one envelope per ready PDF of 5 MB or less | One create call per ready row | `documents/index.ts:292` `assinaCreateEnvelope`. Size rule: `documentSplit.test.ts:193` - `expect(confirmBlock({ ... sizeBytes: 5 * 1024 * 1024 + 1 })).toBe(DOCUMENT_COPY.overEnvelope)`. Ready row: `documentSplit.test.ts:203` - `expect(shouldSend({ envelopeId: null, sellerId: "ana", block: null })).toBe(true)` | ✅ Build gate |
| Send `senderType` WHATSAPP or EMAIL, `authenticationType` DEFAULT_SIGN, `action` SIGN, `folderId` null, and one SIGNATURE at 50% / 50% on every page | That payload | Positions: `documentSplit.test.ts:221` - `expect(signaturePositions(2)).toEqual([{ pageNumber: 1, x: 50, y: 50, element: "SIGNATURE" }, { pageNumber: 2, x: 50, y: 50, element: "SIGNATURE" }])`. Other fields: `documents/index.ts:302` `action: "SIGN"`, `:303` `senderType: channel`, `:304` `authenticationType: "DEFAULT_SIGN"`, `:316` `folderId: null` | ✅ PASS |
| Call Assina AI only from the server, with the token off the browser | Token stays in the function | `supabase/functions/_shared/assinaSync.ts:14` reads `token_cipher`. `assina-credential-persist/index.ts:61` returns `{ status: "connected" }` only. `supabase/migrations/20261014180000_documents.sql:21` grants the table to `service_role` only | ✅ Build gate |
| IF the channel is WhatsApp and the employee has no WhatsApp THEN keep the row in review and show "Sem WhatsApp neste cadastro." | that sentence | `documentSplit.test.ts:194` - `expect(channelBlock("WHATSAPP", { email: "a@b.com", whatsapp: null })).toBe("Sem WhatsApp neste cadastro.")` | ✅ PASS |
| IF the channel is e-mail and the employee has no e-mail THEN keep the row in review and show "Sem e-mail neste cadastro." | that sentence | `documentSplit.test.ts:195` - `expect(channelBlock("EMAIL", { email: null, whatsapp: "11987654321" })).toBe("Sem e-mail neste cadastro.")` | ✅ PASS |
| IF the deadline is empty THEN do not send and show "Informe a data limite." | that sentence | `documentSplit.test.ts:192` - `expect(confirmBlock({ deadline: null, hasToken: true, sizeBytes: 10 })).toBe("Informe a data limite.")` | ✅ PASS |
| IF a ready PDF is over 5 MB THEN keep that row in review and show "O PDF passa de 5 MB. Desligue a unificação ou separe o arquivo." | that sentence | `documentSplit.test.ts:193` - `expect(confirmBlock(...sizeBytes: 5 * 1024 * 1024 + 1)).toBe(DOCUMENT_COPY.overEnvelope)` | ✅ PASS |
| IF Assina AI returns 401, 429, 5xx or the call times out THEN leave that row without an envelope and show the failure on the row | No `envelope_id`, `error` set, later rows still run | `assinaApi.ts:46` returns `{ ok: false, status: 0 }` on throw. `documents/index.ts:318` does not write `envelope_id`; status 0 uses "Não foi possível falar com o Assina AI." at `:323` and `continue` at `:326`. The loop `catch` at `:338` writes the same error at `:340` and moves to the next row | ✅ Build gate |
| WHEN a row already has an envelope id THEN do not create another envelope | `shouldSend` false | `documentSplit.test.ts:200` - `expect(shouldSend({ envelopeId: "env", sellerId: "ana", block: null })).toBe(false)` | ✅ PASS |
| Leave unassigned rows unsent when other rows of the same batch are sent | Unassigned false, ready sibling true | `documentSplit.test.ts:201` - `sellerId: null` `toBe(false)`; `:203` - ready row `toBe(true)` | ✅ PASS |

### P1: Pasta do colaborador (DOCS-04)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN one store is selected and a document is sent THEN show it at Colaborador › Ano › Mês, named with the category | `["Ana", "2026", "Outubro"]` and `Holerite.pdf` | `documentSplit.test.ts:151` - `expect(folderSegments({ allStores: false, ... month: 10 })).toEqual(["Ana", "2026", "Outubro"])`. Name: `documentSplit.test.ts:143` - `expect(fileName("Holerite", [])).toBe("Holerite.pdf")`. Screen: `DocumentsPage.tsx:236` | ✅ PASS |
| WHEN all stores are selected THEN show Filial › Colaborador › Ano › Mês | `["Campo Grande", "Ana", "2026", "Outubro"]` | `documentSplit.test.ts:156` - `expect(folderSegments({ allStores: true, storeName: "Campo Grande", ... })).toEqual(["Campo Grande", "Ana", "2026", "Outubro"])` | ✅ PASS |
| WHEN that path already has the same category THEN name the next file `(2)`, then `(3)` | `Holerite (2).pdf`, then `Holerite (3).pdf` | `documentSplit.test.ts:144` - `toBe("Holerite (2).pdf")`; `:145` - `toBe("Holerite (3).pdf")` | ✅ PASS |
| Show Documentos at `/documents` on the Gestor menu, outside Gestão and outside Configurações | Sibling of Estoque | `src/layout/nav-wedash.ts:25` label Documentos. Placed at `nav-wedash.ts:97` in `b123331` (dirty shopping line is not in this range). `src/router/paths.ts:41` `"/documents"` | ✅ Build gate |
| WHEN the role is Gerente or Vendedor THEN hide Documentos and do not show the files | Menu, route, and RLS omit them | `nav-wedash.ts:131` seller nav; `:133` manager nav. `src/pages/documents/routes.tsx:11` `RequireRole` `OWNER_ROLES`. RLS `20261014180000_documents.sql:88` and `:103` | ✅ Build gate |
| WHEN the topbar has one store THEN list only employees and batches of that store | Filtered to that `store_id` | `src/data/wedash/documentsRepo.ts:86` `inStore`. Page: `DocumentsPage.tsx:50` | ✅ Build gate |
| WHEN the topbar is all stores THEN list every store, with a folder per store | One folder per store | `DocumentsPage.tsx:232` `stores.map(...)` when `allStores` | ✅ Build gate |
| WHEN a folder has no files THEN show an empty folder | Empty state | `DocumentsPage.tsx:194` `EmptyState` title "Pasta vazia" | ✅ Build gate |

### P1: Cobrar pelo lote (DOCS-05)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHILE a batch has at least one document that is not Assinado THEN show Pendente | `"Pendente"` | `documentSplit.test.ts:168` - `expect(batchLabel(["SIGNED", "PENDING"])).toBe("Pendente")`; `:169` DECLINED; `:170` EXPIRED | ✅ PASS |
| WHEN every document is Assinado THEN show Assinado | `"Assinado"` | `documentSplit.test.ts:167` - `expect(batchLabel(["SIGNED", "SIGNED"])).toBe("Assinado")` | ✅ PASS |
| WHEN the Gestor opens a batch THEN show a progress bar of Assinado over total, and badges Pendente, Assinado, Recusado, Expirado | Bar and those badges | `DocumentsPage.tsx:318` `{signed} de {total}`; `:321` `ProgressBar`; `:280` badge; labels `:32` | ✅ Build gate |
| Count Recusado and Expirado in the total and not as Assinado | Signed count 1 of those three | `documentSplit.test.ts:172` - `expect(signedCount(["SIGNED", "DECLINED", "EXPIRED"])).toBe(1)`. Total: `DocumentsPage.tsx:276` `rows.length` | ✅ PASS |

### P1: Receber o status e guardar o PDF (DOCS-06)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN `DOCUMENT_COMPLETED` arrives for an envelope this system created THEN mark Assinado and store the file from `signedDocumentUrl` | Status SIGNED and the PDF bytes stored | Status: `documentSplit.test.ts:211` - `expect(applyEnvelopeStatus("PENDING", "COMPLETED")).toBe("SIGNED")`. Wake-up: `assina-webhook/index.ts:34` `syncEnvelope`. Store: `assinaSync.ts:36` downloads the URL and `:41` sets `signed_storage_path` only after upload | ✅ PASS |
| WHEN status is DECLINED THEN mark Recusado | `DECLINED` | `documentSplit.test.ts:212` - `expect(applyEnvelopeStatus("PENDING", "DECLINED")).toBe("DECLINED")` | ✅ PASS |
| WHEN status is EXPIRED THEN mark Expirado | `EXPIRED` | `documentSplit.test.ts:213` - `expect(applyEnvelopeStatus("PENDING", "EXPIRED")).toBe("EXPIRED")` | ✅ PASS |
| WHEN status is CANCELED THEN mark Recusado | `DECLINED` | `documentSplit.test.ts:214` - `expect(applyEnvelopeStatus("PENDING", "CANCELED")).toBe("DECLINED")` | ✅ PASS |
| WHEN the same `eventId` arrives again THEN ignore the duplicate | Second insert does not sync | `20261014180000_documents.sql:67` primary key `event_id`. `assina-webhook/index.ts:27` returns 200 when the insert errors | ✅ Build gate |
| IF the envelope id is not one this system created THEN ignore the webhook | No document update | `assina-webhook/index.ts:30` returns 200 when no row matches | ✅ Build gate |
| WHILE a document is Assinado the system SHALL NOT move it back | Stays `SIGNED` | `documentSplit.test.ts:215` - `expect(applyEnvelopeStatus("SIGNED", "DECLINED")).toBe("SIGNED")`; `:216` EXPIRED stays `SIGNED` | ✅ PASS |
| IF the signed-file download fails THEN keep Assinado and do not store the temporary URL | Status becomes SIGNED, path unset, URL not written | `assinaSync.ts:35` `try`; `:43` `catch` leaves the patch as `{ status: next }`; `:48` updates that patch. `signed_storage_path` is set only at `:41` after a successful upload | ✅ Build gate |
| WHEN the Gestor opens an Assinado file with no stored copy THEN download a fresh copy and store it | `syncEnvelope` runs again | `documents/index.ts:373` calls `syncEnvelope` when `signed_storage_path` is missing | ✅ Build gate |

### P1: Reenviar o link (DOCS-07)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN the Gestor resends a Pendente document THEN call `POST /api/v1/envelopes/resend-signer-link/{envelopeId}/{recipientId}` with the batch channel | That path and the batch `senderType` | `assinaApi.ts:58` that path. `documents/index.ts:355` `channel = batch.channel`; `:357` `senderType: channel`. Visibility: `documentSplit.test.ts:204` - `expect(resendVisible("PENDING")).toBe(true)` | ✅ Build gate |
| IF the document is Assinado, Recusado or Expirado THEN do not show Resend | `resendVisible` false | `documentSplit.test.ts:205` - `expect(resendVisible("SIGNED")).toBe(false)`; `:206` DECLINED; `:207` EXPIRED. Button: `DocumentsPage.tsx:285` | ✅ PASS |
| IF the resend call fails THEN keep Pendente and show the failure | Status unchanged, `error` set | `documents/index.ts:361` writes `error` and does not change `status`. `assinaApi.ts:63` returns false on throw | ✅ Build gate |

### P1: Conectar o Assina AI uma vez (DOCS-08)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| Show an Assina AI card on Integrações at `/settings/erp`, using `/assinaai.png`, for the whole tenant | Card on that route, one row per tenant | `src/pages/settings/AssinaCard.tsx:41` `src="/assinaai.png"`. Mounted at `ErpIntegrationPage.tsx:133`. Route `src/pages/settings/routes.tsx:38` in `b123331`. Primary key `tenant_id`: `20261014180000_documents.sql:13` | ✅ Build gate |
| WHEN the Gestor saves a token and a read call succeeds THEN store that single token and show Conectado | Upsert after HTTP 200, label "Conectado" | `assinaApi.ts:23` `GET /folders/list` must be 200. Upsert: `assina-credential-persist/index.ts:55`. Label: `AssinaCard.tsx:57` | ✅ Build gate |
| WHEN the token is stored THEN do not show it again | Response omits the token | `assina-credential-persist/index.ts:61` returns status only. `AssinaCard.tsx:14` starts from an empty input | ✅ Build gate |
| IF Assina AI rejects the token THEN do not store it and show "Token inválido." | 422 before upsert | `assina-credential-persist/index.ts:53` returns `DOCUMENT_COPY.badToken` and does not upsert | ✅ Build gate |
| IF no token is stored WHEN the Gestor confirms THEN do not send and show the Integrações sentence | that sentence | `documentSplit.test.ts:191` - `expect(confirmBlock({ deadline: "2026-11-13", hasToken: false, sizeBytes: 10 })).toBe(DOCUMENT_COPY.noToken)` | ✅ PASS |
| Allow only the Gestor to save or replace the token | Non-owner gets 403 | `assina-credential-persist/index.ts:35` `OWNER_ROLES`. Button: `AssinaCard.tsx:59` `disabled={!canEdit}` | ✅ Build gate |
| Do not ask for a token per store | One company row | `20261014180000_documents.sql:12` `tenant_id` primary key, no store column | ✅ Build gate |

**Status**: ✅ All ACs covered

**Spec-anchored check**: 58/58 criteria covered. 34 match a unit assertion. 24 are the build-gated schema, edge, or screen path and the implementation line matches the spec. 0 behavior gaps.

---

## Discrimination Sensor

`documentSplit.ts` is not in `0e9629d`. The sensor from the prior pass still applies to that file. Scratch copies only. The repo file was not edited.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| 1 | `src/data/wedash/documentSplit.ts:163` | Empty batch returned Assinado | ✅ Killed — `expected 'Assinado' to be 'Pendente'` |
| 2 | `src/data/wedash/documentSplit.ts:74` | Check digits skipped, so any 11 digits were accepted | ✅ Killed — bad CPF stored; first-CPF assertion failed |
| 3 | `src/data/wedash/documentSplit.ts:205` | Resend visible on SIGNED | ✅ Killed — `expected true to be false` |

**Sensor depth**: lightweight
**Sensor**: 3 injected, 3 killed, 0 survived

The new cross-file assertion is `documentSplit.test.ts:98`. It fails if `groupPages` stops merging two source indexes.

---

## Interactive UAT Results (if performed)

Not performed. This pass confirms the three fixes, the unit gate, and the spec lines.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ The fix collects pages, then calls the existing `groupPages`. |
| Surgical changes | ✅ `0e9629d` touches the prepare loop, the create client, `syncEnvelope`, and the domain test. |
| No scope creep | ✅ |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ The three previously wrong behaviors now match the spec. |
| Per-layer Coverage Expectation met | ✅ Domain rules have unit assertions, including categories and cross-file unify. Edge, schema, and screen stay on the build gate, as the matrix says. |
| Every test maps to a spec requirement | ✅ The two new tests map to DOCS-02 criteria 2 and 3. |
| Documented guidelines followed: none — strong defaults applied (`tasks.md`) | ✅ |

`folderSegments` is still unused by `DocumentsPage.tsx`, which builds the same path in `folderEntries`. The asserted path matches the spec, and the screen shows that path. That does not change a spec outcome.

---

## Edge Cases

- [x] Confirm twice creates an envelope only for rows that still have none. `documentSplit.test.ts:200`. `documents/index.ts:280`.
- [x] A late older status after Assinado stays Assinado. `documentSplit.test.ts:215`. `documentSplit.ts:209`.
- [x] One envelope fails and the next succeeds. HTTP errors `continue` at `documents/index.ts:326`. A throw is caught at `:338` and the loop proceeds.
- [x] Unify on, one merged PDF over 5 MB, keeps that employee in review and still sends the others. `documentSplit.test.ts:193` and `:202`. Grouping now happens across the batch first (`documents/index.ts:174`).

---

## Gate Check

- **Gate command**: `npx vitest run src/data/wedash/documentSplit.test.ts`
- **Result**: 20 passed, 0 failed, 0 skipped
- **Test count before feature**: 0 (`documentSplit.test.ts` arrives in `3c9c0ac`)
- **Test count after feature**: 20
- **Delta**: +20 (18 in `3c9c0ac`, +2 in `0e9629d`)
- **Skipped tests**: none
- **Failures**: none
- **Lint and build**: not re-run. The dirty tree still changes `src/layout/nav-wedash.ts` and `src/pages/settings/routes.tsx` for unrelated shopping work, so a fresh lint/build would describe the wrong tree. Nothing was stashed.

---

## Fix Plans (if issues found)

None. The three behavior gaps from the prior report are fixed in `0e9629d`.

---

## Requirement Traceability Update

`spec.md` was not edited. Behavior status after this re-verify:

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| DOCS-01 | Implemented | ✅ Verified |
| DOCS-02 | Needs Fix | ✅ Verified |
| DOCS-03 | Needs Fix | ✅ Verified |
| DOCS-04 | Implemented | ✅ Verified |
| DOCS-05 | Implemented | ✅ Verified |
| DOCS-06 | Needs Fix | ✅ Verified |
| DOCS-07 | Implemented | ✅ Verified |
| DOCS-08 | Implemented | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 58/58 covered (34 unit assertions, 24 build gate). 0 behavior gaps.
**Sensor**: 3/3 mutations killed
**Gate**: 20 passed, 0 failed

**What works**: One CPF in two accepted PDFs becomes one group before the PDF is built. A thrown create returns status 0, the row records the failure, and the next row still runs. A thrown signed-file download still sets Assinado and does not store the temporary URL.

**Issues found**: none

**Next steps**: None for these three gaps. Do not deploy, push, or apply migrations from this pass.
