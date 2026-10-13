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
- Configurações > Shopping fica no menu do Gestor. Fora de quiosque, a tela mostra que está disponível apenas para Quiosque em shopping. O card da Allos fica Configurado ou Não configurado: salvar o acesso não testa o login.
- Calendário no padrão de Fechamento e Sangrias. O campo de período é o mesmo das outras telas: Hoje, Ontem, Esta semana, Este mês, Este trimestre, Este semestre e Este ano. Ao abrir, o período é Este mês e o calendário mostra todos os dias desse mês. Os totais seguem os dias fechados do intervalo.
- O Atualizar do topo busca as vendas de hoje no Millennium e lê os valores já informados ao shopping. Não informa venda nova. O botão Informar vendas pede confirmação e envia só os dias passados marcados que ainda não têm valor. A caixa só aparece nesses dias. Loja de rua, filial sem acesso e Argo não chamam o painel.
- KPIs dos dias anteriores a hoje: Vendido, Informado, Diferença (informado menos vendido), sempre em reais. Diferença zero é R$ 0,00 em cor neutra. A mais é âmbar. A menos é vermelho.
- Vendido é o total da filial (marca ALL). WEPINK e WPINK não somam de novo.
- Abrir o informe só lê o que já está gravado. A Allos entra pelo job da madrugada ou pelo botão Informar vendas. O Atualizar abre o login num navegador no sincronizador só para ler. Um POST só com usuário e senha é recusado.
- Dia passado sem valor gravado aparece como Não informado. Zero gravado aparece como Informado R$ 0,00.
- Cada dia passado com venda mostra o valor, sem a palavra Vendido, e o chip Informado. Informado verde quando bate com o vendido, âmbar quando está acima e vermelho quando está abaixo. Sem valor gravado, o dia mostra Não informado, em amarelo, com caixa, inclusive quando a venda é zero. Depois do envio, zero gravado aparece como Informado R$ 0,00. Hoje mostra o valor quando já houver venda, e o chip Em aberto na cor primary mesmo sem lançamento. O dia atual e o dia passado abrem uma modal só de consulta. O futuro fica vazio e sem clique.
- O Informar vendas não abre o navegador se nenhum dia marcado está sem valor. Dois cliques seguem na mesma máquina.
- Diferença a mais: aluguel percentual a mais. A menos: risco de divergência na auditoria. No total, dia sem valor informado conta como zero. No dia, não vira R$ 0,00 informado.

### Agent's Discretion

- Onde cifrar a senha, desde que o padrão seja o da chave da adquirente.
- O texto curto do dia no calendário ficou definido: Vendido R$ X e Informado R$ X, ou Não informado.

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
