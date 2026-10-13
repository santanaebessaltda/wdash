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
- Card em Configurações, `/operation/shopping`, só Gestor. Uma filial por vez, como Adquirentes. O item só aparece com um quiosque selecionado.
- Na tela, só o card da Allos. A modal mostra URL e usuário já salvos; a senha fica mascarada. A URL é o endereço do painel, sem barra no final. Conectar só grava o acesso: não testa o login e não lança as vendas. O card da Argo entra junto com o envio dela.
- Informe de vendas só aparece nesse quiosque quando a Allos está salva.
- Loja de rua não entra.

### Allos

- Host de exemplo: `app3.intranetmall.com/{caminho-da-filial}/`.
- Passos: login em `db/autentica.asp`, semanas em `loja/vendas-s4/vendas.asp`, dias em `vendas_alterar.asp?IDSEMANA=`, salvar em `vendas_atualizar.asp`, sair em `logout.asp`.
- O salvar manda `dias` com a quantidade que a Allos mostrou (1 a 11; a primeira semana do mês pode ser curta), `idsemana` e `venda0` … com `data_cadastra`. Valor no formato `6.756,80`. Vazio vai vazio.
- Só a linha Informada. Online não recebe número.

### Rotina

- Roda depois do fechamento noturno daquele quiosque.
- Cobre todo dia anterior a hoje que esteja vazio, na janela aberta e nas anteriores.
- Reenvia o valor que o formulário já tem. Não substitui.
- Dia de hoje e dias futuros seguem vazios.

### Tela

- Gestão > Informe de vendas, `/management/sales-report`, depois de Sangrias. Gestor e Gerente. O item fica no menu. Loja de rua e quiosque sem Allos mostram empty state, sem esconder o item.
- Configurações > Shopping fica no menu do Gestor. Fora de quiosque, a tela mostra que vale para quiosque em shopping.
- Calendário do mês, no padrão de Fechamento e Sangrias. O cabeçalho tem Mensal e Semanal, no controle do calendário. Mensal soma o mês. Semanal soma o bloco da Allos selecionado (domingo a sábado, cortado no mês).
- O Atualizar do topo, nesta tela, não pede as vendas de hoje no Millennium. Abre a Allos só se o mês ainda tiver dia passado sem lançamento. Loja de rua, filial sem acesso e Argo não chamam o painel. O filtro Semanal não muda essa trava.
- KPIs dos dias anteriores a hoje: Vendido, Lançado, Diferença (lançado menos vendido). Os números seguem Mensal ou Semanal.
- Vendido é o total da filial (marca ALL). WEPINK e WPINK não somam de novo.
- Abrir o informe só lê o que já está gravado. A Allos entra pelo job da madrugada ou pelo Atualizar do topo, o mesmo botão de Fechamento e Sangrias. O clique abre o login num navegador no sincronizador e reusa essa sessão, com o mesmo identificador do navegador. Um POST só com usuário e senha é recusado.
- Dia passado sem lançamento gravado conta como zero no KPI e no badge.
- Cada dia passado mostra o badge Vendido e o badge Lançado. Lançado verde quando os dois são iguais, vermelho quando diferem.
- No Semanal, o calendário marca o bloco selecionado. O bloco aberto só entra nos números com os dias já fechados.
- O Atualizar não abre o navegador se todo dia passado do mês já tem lançamento gravado. Dois cliques seguidos esperam na mesma máquina; o segundo não abre de novo se o primeiro já cobriu o mês.
- Diferença positiva: aluguel percentual a mais. Negativa: risco de multa. Dia passado sem lançamento conta como zero lançado.

### Agent's Discretion

- Onde cifrar a senha, desde que o padrão seja o da chave da adquirente.
- O texto curto do dia no calendário ficou definido: badge Vendido e badge Lançado.

### Declined / Undiscussed Gray Areas → Assumptions

- Nenhuma ficou sem registro. As escolhas estão na spec.

---

## Specific References

- Painel Clube do Lojista, Shopping Campo Grande, administradora Allos.
- Semana de domingo a sábado. Períodos já enviados mostram protocolo e Editar.

---

## Deferred Ideas

- Card e conector da Argo, quando houver os curls.
- Linha Online, se um dia ela representar outra venda.
