# Informe de vendas no shopping — Context

**Gathered:** 2026-10-13
**Spec:** `.specs/features/shopping-report/spec.md`
**Status:** Ready for design

---

## Feature Boundary

A madrugada informa as vendas brutas dos quiosques no painel do shopping e a tela Informe de vendas mostra se o lançado bate com o vendido.

---

## Implementation Decisions

### Administradora e filial

- Allos e Argo são os tipos. O mesmo tipo usa o mesmo lançamento. Mudam URL, usuário e senha.
- Card em Configurações, `/operation/shopping`, só Gestor. Uma filial por vez, como Adquirentes.
- Loja de rua não entra.

### Allos

- Host de exemplo: `app3.intranetmall.com/{caminho-da-filial}/`.
- Passos: login em `db/autentica.asp`, semanas em `loja/vendas-s4/vendas.asp`, dias em `vendas_alterar.asp?IDSEMANA=`, salvar em `vendas_atualizar.asp`, sair em `logout.asp`.
- O salvar manda `dias=7`, `idsemana` e `venda0` … `venda6` com `data_cadastra`. Valor no formato `6.756,80`. Vazio vai vazio.
- Só a linha Informada. Online não recebe número.

### Rotina

- Roda depois do fechamento noturno daquele quiosque.
- Cobre todo dia anterior a hoje que esteja vazio, na janela aberta e nas anteriores.
- Reenvia o valor que o formulário já tem. Não substitui.
- Dia de hoje e dias futuros seguem vazios.

### Tela

- Gestão > Informe de vendas, `/management/sales-report`, depois de Sangrias. Gestor e Gerente.
- Calendário do mês, no padrão de Fechamento e Sangrias.
- KPIs dos dias anteriores a hoje: Vendido, Lançado, Diferença (lançado menos vendido).
- Diferença positiva: aluguel percentual a mais. Negativa: risco de multa. Dia passado sem lançamento conta como zero lançado.

### Agent's Discretion

- Onde cifrar a senha, desde que o padrão seja o da chave da adquirente.
- O texto curto do dia no calendário, desde que o valor lançado e a diferença apareçam.

### Declined / Undiscussed Gray Areas → Assumptions

- Nenhuma ficou sem registro. As escolhas estão na spec.

---

## Specific References

- Painel Clube do Lojista, Shopping Campo Grande, administradora Allos.
- Semana de domingo a sábado. Períodos já enviados mostram protocolo e Editar.

---

## Deferred Ideas

- Conector da Argo, quando houver os curls.
- Linha Online, se um dia ela representar outra venda.
