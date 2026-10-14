# Assinatura de documentos

## Problem Statement

O gestor manda holerite e documentos parecidos para cada colaborador assinar. Hoje isso acontece fora do WDash, e um PDF da folha traz vários CPFs no mesmo arquivo. A tela passa a cortar esse PDF, pedir a assinatura no Assina AI e guardar o arquivo na pasta da pessoa, com o lote à vista para cobrar quem ainda não assinou.

## Goals

- [ ] Um PDF digital com vários CPFs vira um envelope por colaborador, e o Assina AI dispara WhatsApp ou e-mail.
- [ ] O arquivo fica em Colaborador › Ano › Mês, com o nome da categoria, e o status Pendente ou Assinado.
- [ ] A lista de lotes mostra quantos já assinaram e permite reenviar para quem está Pendente.
- [ ] Uma conexão do Assina AI vale para todas as filiais.

## Out of Scope

| Feature | Reason |
| --- | --- |
| PDF escaneado e OCR | A API publicada não lê imagem. O corte exige texto selecionável. |
| Exigir os 4 últimos dígitos do CPF para abrir o arquivo | O campo não existe na coleção publicada em 27/04/2026. |
| Árvore de pastas dentro do Assina AI | A pasta de lá é rasa. A árvore fica no WDash e o envelope sai com `folderId` nulo. |
| Portal do colaborador no WDash | A pessoa assina no link do Assina AI. |
| Token do Assina AI por filial | A chave é da empresa. A filial só organiza a pasta. |
| Cancelar envelope pela tela | O v1 não oferece a ação. O status `CANCELED`, se chegar, aparece como Recusado. |
| Tela de métricas do envio | O gestor vê o status e o erro na linha. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Quem usa | Gestor (`OWNER` e `ADMIN_GLOBAL`). Gerente e Vendedor não veem o menu nem a tela | O contexto fechou a tela no gestor. Holerite não entra no menu de Gestão, que o Gerente também abre. | y |
| Rota | Item Documentos no menu do Gestor, no mesmo nível de Estoque, em `/documents` | Fora de Gestão, porque o Gerente abre aquele grupo. Fora de Configurações, porque lá é o ajuste de uma filial e esta tela é o trabalho do mês. | n |
| Conexão | Um token na empresa, no card Assina AI em Conta › Integrações, ícone `/assinaai.png` | Igual ao Millennium. A Stone fica de fora desse card porque a chave dela é da loja. | y |
| Pastas com todas as filiais | Filial › Colaborador › Ano › Mês | Com uma filial no topo, a filial já está escolhida e a pasta começa no colaborador. | y |
| Loja | Uma filial no topo casa o CPF só nela. Todas as filiais casa no tenant e guarda o arquivo na filial da ficha | O holerite de outra loja não pode cair na pasta da loja que está na tela. | y |
| CPF repetido | Duas fichas com o mesmo CPF ficam sem dono até o gestor escolher | Escolher sozinho mandaria o holerite para a loja errada. | n |
| Vários CPFs na mesma página | Vale o primeiro CPF válido | Folha costuma ter um CPF por página. | n |
| Limite do lote | Até 5 PDFs. Cada origem até 15 MB e 1.000 páginas | É o teto da tela de referência. O envelope enviado continua no teto da API, 5 MB. | n |
| Prazo | Obrigatório no lote. Sem data padrão | O contexto pôs o prazo no lote e não definiu um deslocamento. | n |
| Lembrete | `EVERY_3_DAYS`, trocável por `EVERY_DAY`, `EVERY_WEEK` ou `NEVER` | São os valores da API. O padrão foi fechado no contexto. | y |
| Assinatura | `DEFAULT_SIGN`, elemento `SIGNATURE` em 50% da largura e 50% da altura, em toda página | O contexto pediu assinatura na tela, no centro de cada página. | y |
| Unificação | Ligada por padrão. Desligada, cada página vira um envelope | O contexto pediu um PDF por CPF, com a opção de desligar. | y |
| Confirmar de novo | Linha que já tem envelope não é enviada outra vez | Evita documento duplicado se o gestor confirma o que ainda estava bloqueado. | n |
| Assinado não volta | Status Assinado não regressa | Um webhook atrasado não pode reabrir cobrança de quem já assinou. | n |
| `CANCELED` | A linha mostra Recusado | Não há ação de cancelar nem um selo próprio. O documento não foi assinado. | n |
| Arquivo assinado | Cópia no WDash. Se faltar, abrir o arquivo busca de novo | A URL do Assina AI expira em 60 minutos no webhook e 90 no detalhe. | y |
| Webhook desconhecido | Evento cujo envelope não é nosso é ignorado | A coleção não documenta assinatura do webhook. | n |
| Token | Só no servidor | A documentação manda não expor `sk_live` no frontend. | y |
| Observabilidade | Sem painel extra | O erro fica na linha do lote. | n |
| Limite de taxa da API | Sem fila própria. HTTP 429 deixa a linha sem envelope | A coleção não publica cota. | n |

**Open questions:** none - all resolved or logged above.

### Implicit dimensions

- Input bounds: 5 PDFs, 15 MB e 1.000 páginas na origem, 5 MB no envelope, CPF com dígitos verificadores, telefone com 10 ou 11 dígitos.
- Partial failure: linha que o Assina AI recusou fica na revisão; linha já enviada permanece.
- Idempotency: `eventId` repetido não muda estado; confirmar de novo não cria outro envelope.
- Auth: só Gestor; token fora do browser; webhook só para envelope criado aqui.
- Concurrency: Assinado é terminal.
- Lifecycle: a cópia assinada fica no WDash; link temporário não é o arquivo.
- External failure: timeout, 401, 5xx e 429 não marcam a linha como enviada.
- State integrity: Pendente, Assinado, Recusado, Expirado. O lote só fica Assinado quando todos os documentos estão Assinados.
- Observability: N/A because the row already shows the error.

---

## User Stories

### P1: Cadastro para achar o destinatário ⭐ MVP

**User Story**: As a Gestor, I want to save CPF, e-mail and WhatsApp on the store employee so that the split can find who receives the document.

**Why P1**: Sem CPF não há corte automático. Sem contato o Assina AI não dispara.

**Acceptance Criteria**:

1. WHEN the Gestor saves a store employee THEN the system SHALL store CPF, e-mail and WhatsApp on that `store_seller`.
2. IF the CPF does not have 11 digits or the check digits fail THEN the system SHALL reject the save and SHALL show "CPF inválido."
3. IF the WhatsApp does not have 10 or 11 digits THEN the system SHALL reject the save and SHALL show "WhatsApp inválido."
4. IF the e-mail has no @ THEN the system SHALL reject the save and SHALL show "E-mail inválido."
5. The system SHALL keep an empty e-mail and an empty WhatsApp when the Gestor clears that field.

**Independent Test**: Gravar um CPF válido e um WhatsApp de 11 dígitos numa ficha. CPF com dígito errado não grava.

---

### P1: Cortar o PDF e revisar

**User Story**: As a Gestor, I want one digital PDF with many CPFs split by person so that I can fix the pages nobody owns before anything is sent.

**Why P1**: É o pedido central. A API do Assina AI não corta o arquivo.

**Acceptance Criteria**:

1. WHEN the Gestor adds PDFs to a batch with month, year and one category THEN the system SHALL read the text of each page and group pages by CPF.
2. The system SHALL accept only these categories: Holerite, Espelho de ponto, Adiantamento salarial, Vale transporte, Vale alimentação / refeição, Participação nos lucros (PLR), Informe de rendimentos, Outros.
3. WHILE unify is on the system SHALL build one PDF per matched CPF, with every page of that CPF in the batch.
4. WHEN unify is off THEN the system SHALL build one PDF per page.
5. WHEN exactly one employee in the current store scope has that CPF THEN the system SHALL assign that employee.
6. IF a page has no CPF, the CPF matches nobody, or more than one employee has that CPF THEN the system SHALL leave that page unassigned and SHALL NOT create an envelope.
7. IF a file has no extractable text THEN the system SHALL refuse that file and SHALL show "Arquivo escaneado não é aceito. Envie o PDF gerado pelo sistema de folha."
8. IF the batch already has 5 PDFs THEN the system SHALL refuse another file and SHALL show "O lote aceita até 5 PDFs."
9. IF a source PDF is over 15 MB or over 1000 pages THEN the system SHALL refuse that file and SHALL show "Cada PDF de origem aceita até 15 MB e 1.000 páginas."
10. IF the file is not a PDF THEN the system SHALL refuse it and SHALL show "Envie apenas PDF."
11. WHEN the Gestor picks an employee for an unassigned page THEN the system SHALL assign that page and SHALL keep it unsent.
12. IF month, year or category is missing THEN the system SHALL NOT split the files.

**Independent Test**: Um PDF de duas páginas, dois CPFs, um cadastrado. A revisão mostra uma pessoa pronta e uma página pedindo colaborador. Nenhum envelope existe ainda.

---

### P1: Disparar pelo Assina AI

**User Story**: As a Gestor, I want to confirm the batch so that each ready person receives one signature link on WhatsApp or e-mail.

**Why P1**: Sem o disparo o corte não chega no colaborador.

**Acceptance Criteria**:

1. WHEN the Gestor confirms a batch with channel, deadline and reminder THEN the system SHALL create one Assina AI envelope per ready PDF that is 5 MB or smaller.
2. The system SHALL send `senderType` `WHATSAPP` or `EMAIL`, `authenticationType` `DEFAULT_SIGN`, `action` `SIGN`, `folderId` null, and one `SIGNATURE` position at 50% width and 50% height on every page.
3. The system SHALL call Assina AI only from the server, with the API token kept off the browser.
4. IF the channel is WhatsApp and the employee has no WhatsApp THEN the system SHALL keep that row in review and SHALL show "Sem WhatsApp neste cadastro."
5. IF the channel is e-mail and the employee has no e-mail THEN the system SHALL keep that row in review and SHALL show "Sem e-mail neste cadastro."
6. IF the deadline is empty THEN the system SHALL NOT send and SHALL show "Informe a data limite."
7. IF a ready PDF is over 5 MB THEN the system SHALL keep that row in review and SHALL show "O PDF passa de 5 MB. Desligue a unificação ou separe o arquivo."
8. IF Assina AI returns 401, 429, 5xx or the call times out THEN the system SHALL leave that row without an envelope and SHALL show the failure on the row.
9. WHEN a row already has an envelope id THEN the system SHALL NOT create another envelope for that row.
10. The system SHALL leave unassigned rows unsent when other rows of the same batch are sent.

**Independent Test**: Confirmar um lote com uma pessoa pronta e uma sem CPF. Só a pessoa pronta ganha envelope e fica Pendente. A outra continua na revisão.

---

### P1: Pasta do colaborador

**User Story**: As a Gestor, I want each signed file under the employee, year and month so that I can open someone's documents the way I open a drive.

**Why P1**: A organização por colaborador é o que a tela entrega depois do envio.

**Acceptance Criteria**:

1. WHEN one store is selected and a document is sent THEN the system SHALL show it at Colaborador › Ano › Mês, named with the category.
2. WHEN all stores are selected and a document is sent THEN the system SHALL show it at Filial › Colaborador › Ano › Mês, using the store of that employee.
3. WHEN that path already has the same category THEN the system SHALL name the next file with the suffix `(2)`, then `(3)`.
4. The system SHALL show Documentos at `/documents` on the Gestor menu, outside Gestão and outside Configurações.
5. WHEN the role is Gerente or Vendedor THEN the system SHALL hide Documentos and SHALL NOT show the files.
6. WHEN the topbar has one store THEN the system SHALL list only employees and batches of that store.
7. WHEN the topbar is all stores THEN the system SHALL list every store of the tenant, with a folder per store.
8. WHEN a folder has no files THEN the system SHALL show an empty folder.

**Independent Test**: Com uma filial no topo, o holerite de outubro de 2026 da Ana aparece em Ana › 2026 › Outubro como `Holerite.pdf`. Com todas as filiais, o mesmo arquivo aparece em Filial da Ana › Ana › 2026 › Outubro. O segundo do mesmo mês mostra `Holerite (2).pdf`.

---

### P1: Cobrar pelo lote

**User Story**: As a Gestor, I want each batch to show who has signed so that I can chase the people still pending.

**Why P1**: A pasta não serve para achar, num mês, quem ainda não assinou.

**Acceptance Criteria**:

1. WHILE a batch has at least one document that is not Assinado the system SHALL show the batch as Pendente.
2. WHEN every document in the batch is Assinado THEN the system SHALL show the batch as Assinado.
3. WHEN the Gestor opens a batch THEN the system SHALL show a progress bar of Assinado count over document count, and a table with the person and the badge Pendente, Assinado, Recusado or Expirado.
4. The system SHALL count Recusado and Expirado in the document total and SHALL NOT count them as Assinado.

**Independent Test**: Lote com 2 documentos, 1 Assinado. A barra mostra 1 de 2 e o lote permanece Pendente. Com os 2 Assinados, o lote fica Assinado.

---

### P1: Receber o status e guardar o PDF

**User Story**: As a Gestor, I want the signed PDF stored here when Assina AI finishes so that the folder still opens after the temporary link dies.

**Why P1**: O link do webhook expira em 60 minutos. Sem a cópia a pasta fica vazia.

**Acceptance Criteria**:

1. WHEN a webhook `DOCUMENT_COMPLETED` arrives for an envelope this system created THEN the system SHALL mark that document Assinado and SHALL store `signedDocumentUrl` as the folder file.
2. WHEN a webhook for an envelope this system created has status `DECLINED` THEN the system SHALL mark that document Recusado.
3. WHEN a webhook for an envelope this system created has status `EXPIRED` THEN the system SHALL mark that document Expirado.
4. WHEN a webhook for an envelope this system created has status `CANCELED` THEN the system SHALL mark that document Recusado.
5. WHEN the same `eventId` arrives again THEN the system SHALL ignore the duplicate.
6. IF the envelope id is not one this system created THEN the system SHALL ignore the webhook.
7. WHILE a document is Assinado the system SHALL NOT move it back to Pendente, Recusado or Expirado.
8. IF the signed-file download fails THEN the system SHALL keep the document Assinado and SHALL NOT store the temporary URL as the file.
9. WHEN the Gestor opens an Assinado file that has no stored copy THEN the system SHALL download a fresh copy from the envelope and store it.

**Independent Test**: `DOCUMENT_COMPLETED` marca Assinado e grava o PDF. O mesmo `eventId` outra vez não altera nada. Um `eventId` novo com status anterior não tira o Assinado.

---

### P1: Reenviar o link

**User Story**: As a Gestor, I want to resend the link to a pending person so that I can chase a signature without building a new batch.

**Why P1**: A cobrança pedida no lote depende do reenvio que a API já oferece.

**Acceptance Criteria**:

1. WHEN the Gestor resends a Pendente document THEN the system SHALL call `POST /api/v1/envelopes/resend-signer-link/{envelopeId}/{recipientId}` with the batch channel.
2. IF the document is Assinado, Recusado or Expirado THEN the system SHALL NOT show Resend.
3. IF the resend call fails THEN the system SHALL keep the document Pendente and SHALL show the failure on the row.

**Independent Test**: Reenviar uma linha Pendente chama o endpoint com `WHATSAPP` ou `EMAIL` do lote. Linha Assinada não mostra Reenviar.

---

### P1: Conectar o Assina AI uma vez

**User Story**: As a Gestor, I want one Assina AI connection for the company so that every store sends documents with the same account.

**Why P1**: Sem o token nenhum lote dispara. A chave não muda por filial.

**Acceptance Criteria**:

1. The system SHALL show an Assina AI card on Integrações at `/settings/erp`, using `/assinaai.png`, for the whole tenant.
2. WHEN the Gestor saves a token and Assina AI accepts a read call THEN the system SHALL store that single token and the card SHALL show Conectado.
3. WHEN the token is stored THEN the system SHALL NOT show it again.
4. IF Assina AI rejects the token THEN the system SHALL NOT store it and SHALL show "Token inválido."
5. IF no token is stored WHEN the Gestor confirms a batch THEN the system SHALL NOT send and SHALL show "A conexão com o Assina AI ainda não foi configurada. Acesse Conta › Integrações para conectar."
6. The system SHALL allow only the Gestor to save or replace the token.
7. The system SHALL NOT ask for a token per store.

**Independent Test**: Salvar o token uma vez. As duas filiais disparam com ele. O card não devolve o token. Sem token, confirmar o lote não cria envelope.

---

## Edge Cases

- WHEN the Gestor confirms twice THEN the system SHALL create an envelope only for rows that still have none.
- WHEN a late webhook with an older status arrives after Assinado THEN the system SHALL keep Assinado.
- IF one envelope in a batch fails and the next succeeds THEN the system SHALL keep the successful envelope and SHALL leave only the failed row unsent.
- IF unify is on and the merged PDF exceeds 5 MB THEN the system SHALL keep that employee in review and SHALL still send the other employees.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DOCS-01 | P1: Cadastro para achar o destinatário | Design | In Design |
| DOCS-02 | P1: Cortar o PDF e revisar | Execute | Implemented |
| DOCS-03 | P1: Disparar pelo Assina AI | Execute | Implemented |
| DOCS-04 | P1: Pasta do colaborador | Design | In Design |
| DOCS-05 | P1: Cobrar pelo lote | Design | In Design |
| DOCS-06 | P1: Receber o status e guardar o PDF | Design | In Design |
| DOCS-07 | P1: Reenviar o link | Design | In Design |
| DOCS-08 | P1: Conectar o Assina AI uma vez | Execute | Implemented |

**Coverage:** 8 total, 0 mapped to tasks, 8 unmapped

---

## Success Criteria

- [ ] Um PDF digital com dois CPFs cadastrados gera dois envelopes e nenhum disparo para página sem dono.
- [ ] O lote mostra a barra Assinados / total e só fica Assinado quando todos os documentos estão Assinados.
- [ ] Depois do `DOCUMENT_COMPLETED`, a pasta abre o PDF guardado no WDash, sem depender do link que expira.
- [ ] Reenviar só aparece em Pendente e usa o canal do lote.
- [ ] Um token do Assina AI, em Integrações, serve para todas as filiais.
