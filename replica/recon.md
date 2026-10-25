# Recon map: Montador de Escalas (web)

Scope: só o Montador de Escalas. As outras ferramentas da Caixa ficam de fora. No WDash tudo fica em Gestão → Escala. Gerar escala abre o wizard em modal. O card do dia mostra o nome do feriado. Regerar preserva o dia ajustado na mão, salvo pedido explícito. Apagar é outra ação e esvazia o mês da filial.
For: gestor e gerente da operação WDash. Não é um produto para vender.
Date: 2026-10-25

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Página pública da Caixa de Ferramentas | https://caixa-de-ferramenta-guia-eb.vercel.app | Home lista o Montador: "Gere escalas 6x1, 5x2, 12x36 com análise de conformidade legal". |
| 2 | O próprio Montador, aberto nessa página | https://caixa-de-ferramenta-guia-eb.vercel.app | Não tem rota própria. `/montador-de-escalas` responde 404. O card chama a ferramenta na mesma página. |
| 3 | Atalho local | `public/gerador-escala.html` | Só um iframe para a URL acima. Não é o app. Não publicar. |
| 4 | Fechamento e Sangrias | telas WDash em Financeiro | Padrão visual pedido: KPIs, calendário do mês, célula do dia. |
| 5 | Equipe | `/team` | Pessoas já vêm do Millennium (`StoreSeller`: nome, código, cargo, ativo, grupo). Não há sexo. |

Não há central de ajuda, página de preço, changelog nem ficha de loja dessa ferramenta.

## Core loop

A pessoa monta a equipe, escolhe o modelo do mês e gera a escala. Depois ajusta o dia na mão e confere quem trabalha, quem folga e se o mês ficou irregular.

No WDash a equipe já existe. Em Gestão → Escala, Gerar escala abre o wizard. Confirmar escreve o mês no calendário. O card do dia mostra o nome do feriado. Um dia ajustado na mão sobrevive a gerar de novo, a menos que a pessoa peça para substituir tudo. Apagar escala esvazia o mês daquela filial.

## Screens

Telas do original. IDs estáveis.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home da Caixa | abrir a URL | Escolher a ferramenta | grade de cards | filled |
| S02 | Passo 1 — Cadastro de funcionários | card Montador de Escalas | Listar quem entra na escala | nome, cargo, sexo, adicionar, lista, contador, próximo | empty (próximo desligado), filled, nome vazio não entra |
| S03 | Passo 2 — Configuração | "Configurar Escala" em S02 | Escolher modelo, mês, folgas e feriados | cards de modelo, mês, ano, domingos, modo de folga, feriados, voltar, gerar | gerar desligado até escolher o modelo; folga fixa escondida no modo rotativo; mês sem feriado |
| S04 | Passo 3 — Escala gerada | "Gerar Escala" em S03 | Ver o mês, corrigir célula, ler resumo e alertas | grade dia a dia, legenda, KPIs, tabela, alertas, análise, imprimir, Excel, voltar, nova | filled; alertas ocultos quando não há; domingo destacado |
| S05 | Minhas escalas | painel aberto acima dos passos | Guardar, reabrir, apagar ou levar o arquivo | nome, salvar, lista, abrir, excluir, baixar JSON, abrir JSON | salvar desligado antes de gerar; rascunho automático; aviso de que os dados ficam só neste navegador |

Barra de progresso, sempre visível: 1 Funcionários → 2 Configuração → 3 Escala gerada. Passo atual, anteriores feitos.

### Alvo no WDash (não existe no original)

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| W01 | Escala do mês | menu Gestão → Escala | Ver o mês, o feriado do dia e quem trabalha | `SectionHeader`, KPIs, calendário, badge de feriado com o nome, badges das pessoas, Gerar escala, Apagar escala | sem escala, loading, filled, dia manual, erro, várias filiais, uma filial, mobile |
| W02 | Wizard Gerar escala | botão Gerar escala em W01 | Montar ou refazer a regra do mês | modal com `WizardSteps` | primeira geração; mês que já tem escala; manter dias manuais ou substituir tudo |
| W03 | Dia da filial | clique no dia de W01, com uma filial no seletor | Ajustar o dia X na mão | modal no padrão do dia de Sangrias, nome do feriado, voltar ao padrão | dia sem escala; dia de feriado; dia já ajustado |

Passos do wizard, no modal:

1. Equipe — pessoas ativas da filial; dá para tirar alguém da escala.
2. Modelo — tipo e folga rotativa ou dia fixo.
3. Regras — mínimo de domingos e feriado municipal. Os nacionais já entram sozinhos.
4. Filiais — esta filial ou copiar a mesma regra para outras.
5. Revisão — gerar. Se o mês já tem escala, a revisão diz o que será substituído.

Configurações não ganha submenu de Escala.

Menu hoje: não existe o grupo Gestão. Equipe é item direto. Fechamento e Sangrias ficam em Financeiro. A decisão deste mapa: Gestão ganha o submenu Escala, com o calendário e o botão Gerar escala. Equipe continua o cadastro de pessoas.

Quem faz o quê: gestor e gerente geram e ajustam o dia nas filiais em que já podem gravar. Copiar para outras filiais fica com o gestor.

Seletor de filial: vazio significa todas. Com uma filial, o dia abre e Apagar escala vale para essa filial. Com várias, o calendário mostra o mês e a edição do dia espera uma filial, como em Sangrias.

Gerar, gerar de novo e apagar:

- Primeira vez: Gerar escala abre o wizard e escrever o mês das filiais escolhidas.
- Mês que já tem escala: o mesmo botão abre o wizard preenchido. No último passo, o padrão é substituir os dias da regra e manter o dia ajustado na mão. A outra opção, explícita, substitui tudo, inclusive o dia manual.
- O nome do feriado no card não depende da escala. Ele aparece mesmo com o mês vazio.
- Apagar escala é outra ação, com confirmação. Esvazia o mês da filial selecionada, inclusive o dia manual. Não mexe em outro mês nem em outra filial.
- Mês passado pode ser apagado, com a confirmação deixando claro que o mês já passou.
- Gerar de novo a filial A não mexe na filial B. Copiar de novo recalcula a filial marcada e mantém o dia manual dela, salvo a opção de substituir tudo.

## Flows

```
F01 Gerar a escala do mês (original)
    S01 -> S02 -> S03 -> S04
    happy path clicks: 6, com uma pessoa já digitada (abrir, adicionar, configurar, escolher 6x1, gerar)
    edge: nenhum funcionário (próximo desligado); modelo não escolhido (gerar desligado); nome em branco; mês com 28, 29, 30 ou 31 dias; equipe de 1 pessoa; domingo sem ninguém trabalhando
```

```
F02 Corrigir um dia (original)
    S04 clique na célula
    happy path clicks: 1 por troca
    ciclo: Trabalho -> Folga -> Feriado trabalhado -> Folga compensatória -> Trabalho
    edge: o resumo e os alertas recalculam na hora; domingo continua marcado
```

```
F03 Guardar e reabrir (original)
    S04 -> S05 nome -> salvar -> abrir depois
    happy path clicks: 3 (nome, salvar, abrir)
    edge: mesmo nome substitui; excluir; baixar JSON e abrir em outro aparelho; limpar dados do navegador apaga a lista; aparelho compartilhado enxerga as escalas
```

```
F04 Folga fixa (original)
    S03 modo Fixas -> um dia de seg a sáb por pessoa -> gerar
    happy path clicks: 2 + um select por pessoa
    edge: domingo não entra no dia fixo; domingo continua oscilando pelo mínimo
```

```
F05 Nova escala (original)
    S04 "Nova Escala" -> S02 vazio
    happy path clicks: 1
    edge: a lista salva em S05 permanece
```

```
F06 Gerar a escala no WDash
    W01 Gerar escala -> W02 passos 1 a 5 -> W01 preenchido
    happy path clicks: 6, sem redigitar nomes
    edge: filial sem pessoa ativa; pessoa afastada; mês que já tem escala cai em F09
```

```
F07 Copiar ao gerar
    W02 passo Filiais -> marca filiais -> gerar
    happy path clicks: 2 além do wizard
    edge: a filial destino já tem dia ajustado na mão; esse dia permanece; a filial não marcada não muda
```

```
F08 Ajustar o dia X
    W01 com uma filial -> W03 -> muda quem trabalha ou quem folga -> salva
    happy path clicks: 3
    edge: várias filiais no seletor; gerar de novo mantém esse dia; voltar ao padrão desfaz o ajuste
```

```
F09 Gerar de novo
    W01 com mês preenchido -> W02 já preenchido -> revisão -> gerar
    happy path clicks: 3 se a regra não muda (abrir, seguir, confirmar mantendo os dias manuais)
    edge: opção de substituir tudo; mês passado
```

```
F10 Apagar a escala
    W01 com uma filial -> Apagar escala -> confirmar
    happy path clicks: 2
    edge: várias filiais no seletor (a ação espera uma filial); mês passado pede confirmação mais clara; o feriado continua no card
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Barra de passos | atual, feito, futuro | 3 etapas no original; 5 no wizard do WDash | S02–S04. No WDash: `WizardSteps` em W02 |
| Campo nome / cargo | texto | vazio, preenchido | S02. No WDash não se cadastra pessoa aqui |
| Select sexo | M, F | default M | S02. A Equipe do WDash não tem esse campo |
| Lista de pessoas | linha com cargo, sexo, remover | vazia, preenchida | S02 |
| Card de modelo | 6×1, 6×2, 5×2, 5×1, 12×36, Espanhola | selecionado, livre | S03 |
| Card de modo de folga | rotativa, fixa na semana | selecionado; painel do dia fixo só na fixa | S03 |
| Select de dia fixo | seg a sáb | um por pessoa | S03 |
| Mês e ano | 12 meses; anos 2025–2031 no original | mês corrente | S03 |
| Mínimo de domingos | 0 a 4, ou todos; separado para homens e mulheres | homens 1, mulheres 2 | S03 |
| Lista de feriados | nacional do mês, municipal acrescentado | vazio, preenchido | S03 |
| Grade do mês | célula T, F, FE, FC; coluna de domingo | clicável | S04. No WDash vira calendário, não tabela |
| KPI | funcionários, dias, modelo, domingos, cobertura do domingo | cor por percentual de cobertura | S04 → cards de W01 |
| Tabela resumo | trabalho, folgas, FE, FC, domingos de folga, máximo consecutivo, status | OK, atenção, irregular | S04 |
| Alerta | consecutivo acima de 6; domingo abaixo do mínimo | oculto se não houver | S04 |
| Análise legal | ok, aviso, falha, nota | 8 verificações | S04. Fora da primeira versão do WDash |
| Painel salvar | lista local, arquivo JSON | salvar desligado, rascunho, erro de arquivo | S05. No WDash a configuração fica no banco |
| Badge de pessoa | trabalha, folga, dia ajustado na mão | um por pessoa no dia | W01, W03. Não existe no original |
| Marca de feriado | nome do feriado no card do dia | com escala ou com o mês vazio | W01, W03. O original lista o nome só no passo de configuração |
| Aviso de atualização | escala gerada, dias manuais mantidos, tudo substituído | some quando não houve exceção | W01 |
| Calendário do mês | célula do dia, hoje, feriado, vazio | uma filial ou várias | W01. Reusar o padrão de Fechamento e Sangrias |
| Modal do wizard | primeira geração, gerar de novo | manter dias manuais ou substituir tudo | W02 |
| Modal do dia | quem trabalha, quem folga, nome do feriado, voltar ao padrão | só com uma filial | W03 |

Estados do dia, no original:

- T — trabalho
- F — folga
- FE — feriado trabalhado
- FC — folga compensatória

O 12×36 do original não é horário. A célula continua sendo o dia: um dia trabalha, o outro folga. A espanhola também cai nessa grade de dias (semana de 48h e semana de 40h, aproximadas por quantidade de folgas no mês).

## Inferred data model

```
Funcionario   nome, funcao, sexo (M|F), folgaFixa (1–6, seg–sáb, só no modo fixo)
              evidence: S02, lista de dia fixo em S03
              confidence: high
              WDash: não criar. Usar a pessoa da Equipe (id, nome, código, cargo, ativo, grupo). Sexo é guess se um dia a regra de domingo feminino entrar; hoje o cadastro não tem.

Modelo        tipo (6x1 | 6x2 | 5x2 | 5x1 | 12x36 | espanhola), modoFolga (rotativa | fixa)
              evidence: S03
              confidence: high

RegraDomingo  minimoHomens, minimoMulheres (0–4 ou todos os domingos do mês)
              evidence: S03, alertas de S04
              confidence: high
              WDash v1: um mínimo só, para toda a equipe, até existir o dado de sexo. guess

Feriado       dia, mes (0 = janeiro), ano, nome; nacional calculado ou municipal
              evidence: S03, passo de marcação depois da grade em S04
              confidence: high
              O nome é da data, não da pessoa. O card do dia no WDash mostra esse nome mesmo sem escala.
              Nacional fixo: 1/1 Confraternização Universal, 21/4 Tiradentes, 1/5 Dia do Trabalho, 7/9 Independência do Brasil, 12/10 Nossa Senhora Aparecida, 2/11 Finados, 15/11 Proclamação da República, 20/11 Dia da Consciência Negra, 25/12 Natal.
              Nacional móvel, a partir da Páscoa do ano: Carnaval = Páscoa menos 47 dias (um dia), Sexta-feira Santa = Páscoa menos 2, Corpus Christi = Páscoa mais 60.
              Municipal: dia e nome digitados, valem para o mês e o ano escolhidos. O original não remove um nacional.
              Na grade original, quem estava em trabalho nesse dia vira FE (feriado trabalhado). Quem estava de folga continua F. A célula não escreve o nome.
              WDash: a lista vem do repositório MIT [joaopbini/feriados-brasil](https://github.com/joaopbini/feriados-brasil), importada uma vez por ano para as cidades das filiais. A filial já tem `city` e `uf`; o código IBGE sai da tabela de municípios desse repositório. Entram o nacional, o estadual da UF, o municipal da cidade e o Carnaval do arquivo de facultativos (16 e 17/2/2026). Quarta de Cinzas e Dia do Servidor ficam de fora. O wizard continua para uma data que o arquivo não trouxer. 2027 ainda não está no repositório; nesse ano os móveis nacionais caem na conta da Páscoa. Em 2026, Campo Grande (5002704) tem Sexta-feira Santa, Corpus Christi, Santo Antônio e Aniversário em 26/8. Três Lagoas (5008305) tem só o aniversário em 15/6, com o nome genérico "Aniversário da Cidade". Dos 8.545 municipais de 2026, 6.686 se chamam apenas "Feriado Municipal", e 3.837 cidades aparecem, não as 5.570.

Escala        mes, ano, diasNoMes, linhas[pessoa][dia] = T|F|FE|FC, nome, atualizadaEm
              evidence: S04, arquivo salvo em S05
              confidence: high

Resumo        por pessoa: dias de trabalho, folgas, FE, FC, domingos de folga, máximo consecutivo, status (OK | ATENÇÃO | IRREGULAR)
              evidence: S04
              confidence: high

Cobertura     por domingo: quantos trabalham / tamanho da equipe
              evidence: S04
              confidence: high
```

O que o WDash precisa a mais, porque o original guarda um único mês neste navegador:

```
ConfiguracaoEscala   filial, mes, modelo, modo de folga, mínimo de domingos, feriados municipais, quem entra, geradaEm
                     Uma por filial e mês. Copiar grava a mesma regra nas filiais marcadas e escreve o mês de cada uma.
                     Gerar de novo a filial A não altera a filial B.
                     confidence: high

DiaEscala            filial, data, pessoa, estado (trabalho | folga | feriado trabalhado | folga compensatória), origem (gerada | manual)
                     origem=manual sobrevive a gerar de novo, salvo a opção de substituir tudo.
                     Apagar escala remove os dias daquele mês daquela filial, manuais inclusive.
                     confidence: high

FeriadoDoDia         data, nome
                     Calculado para o calendário, com ou sem DiaEscala. Não se apaga junto com a escala.
                     confidence: high
```

Relationships: Filial 1–n ConfiguracaoEscala (uma por mês). Filial 1–n DiaEscala. DiaEscala n–1 pessoa da Equipe. Data 0–1 FeriadoDoDia.

Comportamento da geração, em alto nível, sem reaproveitar a implementação: reparte as folgas de domingo para cada pessoa chegar no mínimo e sobrar gente trabalhando; o restante das folgas cai na semana, rotativo ou no dia fixo. Mais de 6 dias seguidos de trabalho e domingo abaixo do mínimo viram alerta. A análise legal do original confere também descanso na semana, intervalo entre jornadas, carga estimada do mês e domingo sem ninguém. Isso fica para depois.

## Feature matrix

See `features.csv`. Must: 21, should: 9, could: 6, skip: 6.

## Out of scope (cannot or should not be cloned)

- As outras ferramentas da Caixa (checklist, contrato, regimento, simulador de custos, demissão).
- A marca, o texto e o rodapé "Método EmpresaBlindada". A escala sai com o nome e os componentes do WDash.
- O código da geração e o texto pronto da análise legal. O comportamento se reescreve; o parecer jurídico não se copia.
- Cadastro manual de funcionário. A Equipe já vem do Millennium.
- Lista salva só neste navegador e arquivo JSON como arquivo oficial. A configuração fica no WDash.
- Horário de entrada e saída. O original marca o dia, não o turno. O grupo da pessoa (turno) já existe na Equipe e não entra nesta versão.
- Conteúdo de CCT de categoria. O original manda consultar a convenção; não traz o texto.

## Size

Original: 5 telas, 5 fluxos, 6 entidades. WDash: 3 telas, 5 fluxos novos, 3 entidades novas em cima da Equipe e da filial.

Partes difíceis: recalcular o mês ao salvar sem apagar o dia manual; calendário com um badge por pessoa; copiar a regra para outras filiais e preservar a exceção de cada uma.

Size: M. Sem a análise legal da CLT na primeira versão.

## Next

Tela em Gestão → Escala (`/schedule`). Tabelas em `supabase/migrations/20261025140000_store_schedule.sql`. A migration entra no banco quando o push publicar o Supabase.
