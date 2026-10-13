# Informe de vendas no shopping

## Problem Statement

O gestor lança, à mão, as vendas brutas de cada quiosque no painel do shopping. Lançar a mais aumenta o aluguel percentual. Lançar a menos gera multa na auditoria. A WDash já tem o faturamento do dia fechado e passa a informar esse valor, e a mostrar se o lançado bate com o vendido.

## Goals

- [ ] A madrugada preenche, na linha Informada, todo dia passado que ainda está vazio, inclusive janelas anteriores.
- [ ] A tela Informe de vendas mostra, no mês, vendido, lançado e a diferença.
- [ ] O Gestor configura Allos ou Argo por quiosque, com URL, usuário e senha.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Linha Online do painel | Não é o faturamento da loja. Lançar os dois contaria a venda duas vezes. |
| Loja de rua | O shopping não cobra informe desses pontos. |
| Conector da Argo | O card existe. O envio automático entra quando houver o contrato da Argo, no mesmo calendário. |
| Reescrever um dia que já tem valor no shopping | Valor digitado no painel permanece. A rotina só cobre campo vazio. |
| Lançar o dia de hoje ou um dia futuro | O faturamento só fecha na madrugada seguinte. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Valor informado | Faturamento do dia da filial na WDash, marcas somadas, em centavos | É o mesmo número da Visão Geral. O painel pede vendas brutas do dia. | y |
| Dia passado sem venda | Lançar 0,00 | Campo vazio na auditoria parece omissão. Zero é o faturamento real. | y |
| Dia passado sem lançamento no KPI | Lançado conta 0 e o dia entra como em branco | A diferença mostra a falta até a rotina cobrir a janela. | y |
| Semana reenviada | Os dias que já têm valor voltam no mesmo formato. Só o vazio de data passada recebe o faturamento | O salvar da Allos manda os sete dias. Mandar vazio no lugar de um valor apagaria o que já foi informado. | y |
| Horário | Depois que o fechamento noturno daquele quiosque gravou o dia | O número precisa ser o do dia encerrado, na mesma madrugada do fechamento. | y |
| Quem vê o calendário | Gestor e Gerente | É o mesmo grupo de Fechamento e Sangrias. | y |
| Quem grava o acesso | Só Gestor | A senha é da filial, como a chave da adquirente. | y |
| Allos | IntranetMall. Login, lista de semanas, formulário da semana, atualizar e logout | É o contrato dos curls de Campo Grande. O caminho da loja muda por filial. | y |
| Falha no shopping | O dia fica como falha e a madrugada seguinte tenta de novo. Nada é apagado no painel | Uma falha no meio da semana não pode zerar dias já aceitos. | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Cobrir os dias vazios ⭐ MVP

**User Story**: As a Gestor, I want each dawn to fill every blank past day in the shopping form so that no closed day stays unreported.

**Why P1**: Sem isso o lançamento manual continua, com risco de multa ou de aluguel a mais.

**Acceptance Criteria**:

1. WHEN the dawn routine runs for a kiosk THEN the system SHALL fill every Informada field whose date is before today and whose current value is empty, including older open windows.
2. WHEN a field already has a value THEN the system SHALL send that same value again.
3. WHEN a field date is today or later THEN the system SHALL send that field empty.
4. WHEN a past day has no sales THEN the system SHALL send 0,00 on the empty Informada field.
5. The system SHALL NOT write the Online line.
6. IF the shopping save fails THEN the system SHALL keep the stored shopping values and retry the blank days on the next dawn.

**Independent Test**: Dada uma semana com domingo vazio, segunda já preenchida e os dias de hoje em diante vazios, a rotina preenche só o domingo com o faturamento e reenvia a segunda como estava.

---

### P1: Ver vendido e lançado

**User Story**: As a Gestor, I want a month calendar of what was reported so that I can see a surplus or a shortage before the audit.

**Why P1**: A mais é prejuízo no percentual. A menos é multa.

**Acceptance Criteria**:

1. WHEN the month is open THEN the system SHALL show Vendido, Lançado and Diferença for days before today, as currency. WHEN the difference is zero THEN the system SHALL show R$ 0,00.
2. The system SHALL compute Diferença as lançado minus vendido, in cents.
3. WHEN a past day has no launch THEN the system SHALL count its lançado as 0 and mark the day blank.
4. The system SHALL show the screen as Informe de vendas at /management/sales-report for Gestor and Gerente.
5. WHEN the selected store is not a kiosk THEN the system SHALL keep Informe de vendas in the menu and SHALL show that the screen is only for a shopping kiosk.
6. WHEN the selected kiosk has no Allos access THEN the system SHALL keep Informe de vendas in the menu and SHALL show that the administrator is not connected.
7. WHEN the person uses Atualizar on Informe de vendas THEN the system SHALL sync today's sales and SHALL read the launched amounts already stored in the mall. The system SHALL NOT post a launch from that button.
8. IF the store is not a kiosk, or the shopping access is not saved THEN the system SHALL not call the mall.
9. IF the mall save fails THEN the system SHALL keep the stored shopping values.
10. WHERE the day has a brand ALL row THEN the system SHALL use that row as Vendido and SHALL NOT add WEPINK or WPINK on top of it.
11. WHEN a past day is on the calendar THEN the system SHALL show a Vendido badge and a Lançado badge. The Lançado badge SHALL be green when the two amounts are equal and red when they differ.
12. IF the mall answers that the login was not accepted THEN the system SHALL keep the stored shopping values and SHALL NOT call the mall again only because the report was opened.
13. WHEN the mall login requires the browser verification THEN the system SHALL open that login page in a browser session before posting the password.
14. WHEN the report is open THEN the period control SHALL be a start and end date, defaulting to the current month, and the calendar SHALL show only the days inside that range. Vendido, Lançado and Diferença SHALL follow the closed days of that range.
15. WHEN the person launches selected days THEN the system SHALL post only the selected past days that have no stored launch. WHEN none of those days is pending THEN the system SHALL NOT open the mall browser.

**Independent Test**: Mês com um dia vendido a R$ 100,00 e lançado a R$ 120,00, e outro vendido a R$ 50,00 sem lançamento. Vendido R$ 150,00, lançado R$ 120,00, diferença R$ 30,00 a menos.

---

### P1: Acesso do shopping por filial

**User Story**: As a Gestor, I want each kiosk to store its mall administrator, URL, user and password so that the dawn routine can sign in.

**Why P1**: Cada filial tem URL e senha próprias. A administradora define o painel.

**Acceptance Criteria**:

1. WHERE the store type is quiosque em shopping the system SHALL show an Allos card at /operation/shopping that opens a modal with URL, user and password.
2. WHEN the selected store is not one kiosk THEN the system SHALL keep Shopping in the menu and SHALL show that the screen is only for a shopping kiosk.
3. The system SHALL allow only the Gestor to save that card.
4. The system SHALL keep the password unreadable after it is saved.

**Independent Test**: Salvar Allos, uma URL e um usuário numa filial quiosque. A senha não volta em claro. Loja de rua mantém o menu e mostra que a tela vale para quiosque.

---

## Edge Cases

- WHEN the week mixes filled days, blank past days and future days THEN the system SHALL fill only the blank past days.
- WHEN two open windows contain blank past days THEN the system SHALL fill both.
- IF the shopping session ends before the save THEN the system SHALL leave every previously stored value in place.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SHOP-01 | P1: Cobrir os dias vazios | Execute | Implementing |
| SHOP-02 | P1: Ver vendido e lançado | Execute | Implementing |
| SHOP-03 | P1: Acesso do shopping por filial | Execute | Implementing |

**Coverage:** 3 total, 0 mapped to tasks, 3 unmapped

---

## Success Criteria

- [ ] Nenhum dia passado vazio permanece vazio depois de uma madrugada bem-sucedida.
- [ ] A diferença do mês é lançado menos vendido, e dia sem lançamento conta como falta.
- [ ] Um valor já presente no shopping não é substituído.
