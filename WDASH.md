# WDash — Rede de Franquias (Wepink / Wpink)

## Identidade do produto
Sistema de gestão analítica para rede de franquias de cosméticos (marcas **Wepink** e **Wpink**).
Público-alvo principal: **gestor sênior / franqueado / dono da rede**, que precisa de dados para **tomada de decisão**, não apenas visualização.

### Fonte das regras (DECIDIDO — 2026-10-07)
As regras de cada feature ficam **neste arquivo**. A pasta `.specs` saiu: as specs tinham ficado atrás do que o produto faz (índice de desempenho com teto de 130% e sem prêmio da gerência; editor de desafio em uma coluna; "Tudo o que vender" na tela; aba Desafios só com os em andamento; ranking do vendedor pela loja inteira).

### Nome WDash (DECIDIDO — 2026-10-04)
- O nome visível do produto é **WDash** (W e D maiúsculos): sidebar, login, onboarding, telas de acesso, aba do navegador, app instalado, PDF e e-mails. `PRODUCT_NAME` em `src/data/wedash/tenant.ts`. O símbolo é a letra **W**.
- Código, pastas, rotas e banco continuam `wedash` (`WedashBrand`, `src/data/wedash/`). Endereço previsto: `wdash.app`.

### Publicação (DECIDIDO — 2026-10-07)
Pedir para subir grava o `main` no GitHub. O resto acompanha esse push:
- **Site:** Worker `wdash` no Cloudflare (build do Vite em `main`). GitHub Pages saiu.
- **Banco e Edge Functions:** Supabase `gjdslociicdkmjxxznyf`. A Action publica quando mudam migrations, functions ou `supabase/config.toml`.
- **Sincronizador:** Fly `wdash-millennium-sync`, região `gru`, uma máquina. A Action publica quando mudam o worker, `src/data/wedash` ou `src/lib`.
- Commit sem `Co-authored-by`.

### Segurança multi-tenant (DECIDIDO — 2026-10-07)
Remediação do security audit (standard):
- **ERP / Millennium:** Edges de controle (`millennium-onboarding`, enqueue, sellers-sync) exigem membership ACTIVE `OWNER|MANAGER|ADMIN_GLOBAL`. Persistência de credencial e wipe = só Gestor (`OWNER|ADMIN_GLOBAL`).
- **Gerente + lojas:** `membership_store` vazio = todas; com vínculos, enqueue/sellers-sync não cruzam loja fora do escopo. Escrita de `membership_store` só `service_role` (Edge).
- **Segredos ERP:** `password_ciphertext` e `millennium_session*` fora do SELECT do `authenticated` (migration `20261007140000_security_harden`).
- **Convite:** `redirectTo` = só `APP_ORIGIN` (nunca origin do body).
- **Senha provisória:** `mergeWithCache` sempre usa a flag do Auth/DB; cliente limpa só via RPC `clear_own_temporary_password` (não pode setar `true`).
- **Worker:** sessão Millennium só em memória (+ coluna `millennium_session`); claim de `sync_job` = UPDATE atômico QUEUED→RUNNING; Actions/CLI pinados por SHA/versão; `verify_jwt=true` em todas as Edges no `config.toml`.
- **Senha do ERP no onboarding:** só na memória do separador (F5 pede de novo). Não vai para `sessionStorage`.
- **CORS das Edges:** só `APP_ORIGIN` e localhost (`CORS_ORIGINS`).
- **Headers do site:** `public/_headers` (nosniff, frame, HSTS, CSP).
- **Tabelas de venda:** `erp-stock-sync` só grava catálogo global para Gestor. Gerente continua no estoque e no saldo das lojas dele.
- **HTTP do Millennium:** o host `:6017` não completa TLS. O esquema fica `http` até o ERP oferecer HTTPS. Cooldown do Atualizar continua desligado (decisão de produto: o gestor clica de novo quando quiser).
- **Escrita por loja:** meta, desafio, turno, horário/fuso da loja e flags da vendedora passam por `staff_can_write_store` (migration `20261008120000_manager_store_writes`). Gerente sem vínculo escreve em todas; com vínculo, só nas lojas ligadas.
- **Convite do painel Supabase:** `provision_franchisee_invite` abre empresa nova só quando o convite não traz `wdash=member`. Convites da WDash (usuários e vendedores) mandam essa marca. Empresa sem nenhum membership é apagada (`delete_orphan_tenant`).

### Sem white label (DECIDIDO — 2026-09-27; substitui "URL do tenant" de 2026-09-21)
- A plataforma aparece **sempre como WDash** (sidebar, login, onboarding, telas de acesso) — `PRODUCT_NAME` + `WedashBrand` (`src/components/wedash/WedashBrand.tsx`). Sem nome, logo ou cor personalizados por empresa.
- **Acesso sempre pelo endereço padrão da WDash.** Sem slug, sem `wdash.app/{slug}`, sem `{empresa}.wdash.app`.
- O **nome da empresa** (`tenant.name`, caixa alta) continua só como **identificação da conta**: etapa "Empresa" do onboarding (só o nome), Meu perfil ("Empresa") e convites ("acessar a WDash como gerente da EMPRESA"). Não aparece como marca da plataforma. Menu do avatar (Topbar) mostra o nome da pessoa.
- Removidos: Configurações > Marca (URLs antigas → Lojas), logo na etapa 1, geração de slug, leitura pública do tenant (anon). Migration `20260927120000_remove_white_label` tira `slug`, `previous_slug`, `display_name`, `logo_url` e `brand_color` do `tenant`.

## Tema visual
- Seguir **estritamente** o tema **Vela** (paleta, componentes, tokens).
- **Não reinventar componentes** — reutilizar os primitives do Vela antes de criar novos.
- Paleta rosa/magenta das referências é apenas inspiração de layout; a execução usa Vela.

## Referências visuais
- Concorrente / BI atual: `docs/referencias/referencia01.png` … `referencia16.jpeg`
- CRUD de Metas (reaproveitar do BI): `docs/referencias/metas01.png`, `metas02.png`, `metas03.png`
- Listagem de Metas no dashboard: `docs/referencias/dashboard-metas01.png`
- Listagem de Desafios no dashboard: `docs/referencias/dashboard-desafios01.png`

---

## Arquitetura de navegação (DECIDIDO)

### 1. DASHBOARD — analítico, read-only, para tomada de decisão
Submenus:
- **Visão Geral** — resumo executivo dos KPIs das demais telas. É a "capa" do dashboard.
- **Financeiro** — DRE, margem, fluxo, evolução de receita, contas.
- **Equipe** — performance individual de vendedores, escada de comissão, ranking, desafios. Foco no INDIVÍDUO.
- **Grupos** — *(pausado 2026-09-17)* fora do menu do Dashboard por enquanto; código preservado. Análise operacional por grupo volta quando o produto pedir. Configurações > Grupos e tarefas permanece.
- **Produtos** — top sellers, curva ABC, margem por SKU, dias de cobertura, produtos em queda.

Princípios do Dashboard:
- **100% leitura** — zero botões de ação/CRUD dentro do dashboard.
- Cada subtela tem **filtros próprios internos**: período (data) e marca (Wepink / Wpink).
- A **marca** não muda os KPIs/cards — muda apenas a **granularidade temporal** da exibição (por hora vs. por dia).
- O filtro de **filial/loja** é **externo** (combo na barra superior global), aplicável a todas as telas. Pode ser 1 ou N lojas.
- O filtro de **período** aceita 1 dia ou mais.
- **Visão Geral = resumo** das outras 3 telas. Não duplica gráficos inteiros; traz os números-chave e aponta para onde drillar.

### 2. FORA DO DASHBOARD — operacional / ações
Módulos (ordem de prioridade a definir depois):
- **Ao Vivo (Real Time)** — o que está acontecendo agora nas lojas. Justifica sair do dashboard por ser "tempo real", não analítico histórico.
- **Vendedores** — gestão ativa da equipe (CRUD, metas individuais, comissões).
- **Metas** — CRUD de metas de faturamento/comissão por loja/período/equipe. Fora do Dashboard (menu próprio). Reaproveitar layout do BI (ver referências metas01-03).
- **Desafios** — gamificação (ver `dashboard-desafios01.png`: desafio, progresso, engajadas, prêmio).
- **Estoque** — separado do dashboard porque o usuário olha o estoque para **tomar ação** (ex.: gerar pedido de compra).
- **Compras** — pedido, cotação, recebimento.
- **Configurações** — lojas, grupos, permissões, integrações, marcas.

---

## Filtros — modelo mental (DECIDIDO)

| Filtro | Escopo | Onde vive | Multi-select |
|---|---|---|---|
| Filial / Loja | Global (todas as telas) | Barra superior (combo externo) | Sim (1..N) |
| Período (data) | Por subtela do Dashboard | Dentro de cada subtela | Range (1 dia ou +) |
| Marca (Wepink/Wpink) | Por subtela do Dashboard | Dentro de cada subtela | Single (muda granularidade) |

Regra da marca:
- Wepink → exibição agregada por **dia** (operação maior, múltiplas lojas).
- Wpink → exibição por **hora** (operação menor, foco intraday).
- Os KPIs e cards são **os mesmos**; só muda o eixo temporal dos gráficos/tabelas.

---

## Princípios de design analítico (gestor sênior de franquias)

Cada tela do dashboard deve responder a perguntas de decisão, não só mostrar números:

**Visão Geral** responde:
- "Minha rede está batendo a meta este mês?"
- "Qual loja está puxando / segurando o resultado?"
- "Estamos melhor ou pior que o mês passado / ano passado?"

**Financeiro** responde:
- "Onde está indo minha margem? Qual categoria/SKU está corroendo lucro?"
- "Tenho caixa para X? Quando vencem minhas contas?"
- "Meu ticket médio está subindo ou caindo, e por quê?"

**Equipe** responde:
- "Quem está batendo meta e quem precisa de intervenção?"
- "Qual turno produz mais? Estou com gente demais/pouco em qual horário?"
- "Quanto vou pagar de comissão se o mês fechar assim?"

**Produtos** responde:
- "Quais SKUs são meus 80/20? Estou perdendo venda por ruptura?"
- "Quais produtos estão em queda e preciso promocionar/descontinuar?"
- "Meu mix está saudável por loja?"

Toda métrica deve ter:
1. **Valor atual**
2. **Comparativo** (vs. meta, vs. período anterior, vs. média da rede)
3. **Tendência** (sparkline / seta / variação %)
4. **Drill-down** (clicar leva ao detalhe — mesmo que o detalhe seja outra subtela)

Sem esses 4 elementos, o número é "dado jogado na tela" — não serve para decisão.

---

## Inventário de componentes Vela disponíveis (mapeado em src/)

### Primitives UI (`src/components/ui/`)
- `Card`, `CardHeader`, `CardTitle` — container padrão de widgets
- `StatCard` — KPI card com ícone, valor animado, delta (↗/↘), sparkline opcional. **Já tem os 4 elementos de decisão** (valor + comparativo + tendência + espaço para drill).
- `AnimatedNumber` — anima transição de valores numéricos
- `Badge` — status pills (ok/bad/neutral/etc.)
- `Button` (primary/secondary/ghost/sm)
- `DataTable` + `DataTableColumn` — tabela com render custom por coluna, align, hideBelow responsivo
- `ProgressBar` (linear) + `RadialProgress` (circular %) 
- `Gauge` — medidor half-circle (bom para "meta atingida %")
- `Tabs` / `TabNav` — navegação por abas (TabNav é route-driven, bom para os 4 submenus do Dashboard)
- `PageHeader` — título + subtitle + breadcrumbs + actions slot
- `Breadcrumbs`, `Tooltip`, `Popover`, `Dropdown`, `Modal`, `Drawer`
- `EmptyState`, `Skeleton`, `Toast`, `Pagination`, `Accordion`, `Timeline`, `Rating`, `Kanban`, `form`

### Charts (`src/components/charts/`) — todos SVG puro, sem libs externas
- `Sparkline` — mini-tendência dentro de StatCard
- `AreaLineChart` — linha suave com área, **suporta `compareData`** (período anterior sobreposto tracejado) + tooltip hover. Perfeito para evolução de receita com comparativo.
- `BarChart` + `StackedBarChart` — barras verticais, stacked com totais
- `DonutChart` — rosca com legenda e centro custom (label+value)
- `Gauge` — medidor radial
- `Heatmap` — mapa de calor (bom para vendas por dia-da-semana × hora)
- `FunnelChart` — funil de conversão
- `GanttChart` — cronograma
- `MapPins` — mapa com pinos (bom para visão multi-loja geográfica)

### Layout (`src/layout/`)
- `Sidebar` + `SidebarContent` — menu lateral colapsável (76px / 258px)
- `MobileDrawer` — sidebar mobile

### Específicos de produto (`src/components/wedash/`)
- `WedashBrand` — marca WDash (símbolo + nome); sem marca por empresa
- ~~`AiChat`~~ **removido (2026-10-07)**: o balão saiu do `AppShell` em 2026-09-28 e o componente `ChatIA` não era importado em lugar nenhum.

### Alertas (DECIDIDO — 2026-09-29)
- **Todo alerta do app usa `Alert`** (`src/components/ui/Alert.tsx`, padrão Components > Alerts do Vela — "Storage almost full" etc.): fundo suave da cor, sem borda, ícone 18px e título em negrito na cor, texto em `text-t1`. Variantes `success · warning · danger · info · accent`; `icon` troca o ícone (Spinner, RadialProgress), `action` = links/botões à direita (`AlertLink` para link de texto), `footer` = conteúdo extra (lista expandida, checkbox).
- Convertidos: produtos sem custo, carga do histórico, busca das vendas de hoje, avisos do Estoque > Produtos (tabela de custo, transferência, estoque negativo, transferência no detalhe), troca de usuário ERP e acessos faltando no Millennium, `AvisoCard` (Instalar o app) e `Avisos`. Alerta novo → `Alert`, nunca caixa com borda própria.

### Stack
- React 19 + Vite 8 + Tailwind 4 + react-router-dom 7
- **Sem biblioteca de charts externa** (tudo SVG próprio) — decisão consciente: manter assim, não adicionar recharts/apexcharts.

### Regra de legibilidade dos gráficos (DECIDIDO — ref: referencia11.jpeg)
- **Valores em R$ visíveis DIRETO no gráfico**, não só no hover. No BI atual, cada barra já traz o número (`13K / 26K`, `73K / 10K`). Isso é leitura instantânea.
- Implementação: adicionar prop `showValues?: boolean` (default `true`) em `BarChart`, `StackedBarChart` e `AreaLineChart`. Renderiza o rótulo do valor fixo no topo da barra / acima do ponto da linha, usando `formatValue`. O hover/tooltip continua existindo para detalhe.
- É **melhoria nos componentes Vela existentes**, não componente novo. Aplica a todas as telas do dashboard.
- Em barras muito juntas ou valores óbvios, o rótulo pode ser opcional por série — mas o default é mostrar.

---

## Checagem de componentes Vela (CONFIRMADO NO CÓDIGO — varredura completa)
> Varridas: todas as páginas (`src/pages/**`), `src/components/ui/index.ts`, dashboards (Analytics/Ecommerce/Finance/Sales/CRM/BI/Logistics/Projects/SaaS) e páginas de forms (DatePickersPage, SelectComponentsPage).
### ✅ Já existem e são reutilizáveis (confirmado)
`StatCard`, `Sparkline`, `AreaLineChart`, `BarChart`+`StackedBarChart`, `DonutChart`, `Gauge`, `Heatmap`, `DataTable`, `ProgressBar`+`RadialProgress`, `Accordion`, `Badge`, `Card`/`CardHeader`/`CardTitle`/`CardSubtitle`, `Tooltip`, `Popover`, `Dropdown`, `Select`/`Input`/`Checkbox`/`Radio`/`Switch`/`FormField` (em `form.tsx`), `Tabs`, `TabNav`, `Pagination`, `Modal`, `Drawer`, `Avatar`/`AvatarGroup`, `Timeline`, `Rating`, `EmptyState`, `Skeleton`/`Spinner`, `Button`, `Breadcrumbs`, `PageHeader`, `Toast`/`useToast`, `KanbanBoard`/`KanbanColumn`/`KanbanCard`, `AnimatedNumber`.
### 🟡 Existe como MARKUP INLINE (não é componente exportado) — extrair, não reinventar
- **Calendário + Date range + Quick ranges**: já está todo montado em `src/pages/forms/DatePickersPage.tsx` (calendário mensal, input "Single date", input "Date range", botões de quick range "Today/Last 7 days/..."). **Não é um componente exportado** — está inline na página. → Ação: **extrair para `ui/DatePicker.tsx` + `ui/DateRangePicker.tsx`** copiando esse markup (já validado visualmente no tema). NÃO criar do zero.
- **Segmented / toggle de opções (WEPINK|WPINK)**: **NÃO existe** em lugar nenhum (grep `Segmented|ToggleGroup|btn-group` = 0 resultados). Mas o padrão visual já existe nos botões de "Quick ranges" da DatePickersPage (`border-acc bg-acc-soft text-acc` quando ativo). → Ação: **criar `ui/Segmented.tsx`** reusando exatamente esse estilo de botão ativo/inativo. É o único componente "novo" de verdade, e é trivial.
### 🔨 Realmente precisam ser criados (mínimo possível)
| Componente | Origem / como construir | Onde entra |
|---|---|---|
| `DateRangePicker` | **Extrair** do markup de `DatePickersPage.tsx` (calendário + range + quick ranges já prontos) | filtro de período das telas |
| `Segmented` | Copiar o estilo dos botões "Quick ranges" (ativo=`border-acc bg-acc-soft text-acc`) | filtro WEPINK/WPINK + seletor de turno |
| `CommissionLadder` | Compor `ProgressBar` (degraus discretos) + `Badge` dourado — o `ProgressBar` atual é contínuo; aqui é por faixa | Escada de Premiação (Equipe) |
### 🟡 Opcional
- `WaterfallChart` (DRE em cascata, Financeiro) — não existe; hoje resolvido com `StackedBarChart` + `DataTable`. Plus visual, não bloqueante.
### ⚠️ Melhoria em componentes existentes (não é novo)
- `showValues?: boolean` (default `true`) em `BarChart`/`StackedBarChart`/`AreaLineChart` — R$ direto na barra/linha. Evolução dos que já existem.
- ⓘ nos títulos = `CardTitle` + `Tooltip` (Tooltip **já existe**). Só compor.
### Padrão de grade dos dashboards Vela (confirmado no código — replicar nas nossas telas)
- **AnalyticsDashboard**: KPIs `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; blocos de gráfico `lg:grid-cols-3` com card principal `lg:col-span-2`.
- **EcommerceDashboard**: KPIs `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; gráficos `lg:grid-cols-[1.5fr_1fr]` e `lg:grid-cols-[1fr_1.7fr]` (proporções assimétricas, não só 50/50).
- → Nossas telas já seguem isso (KPIs 4/linha desktop, pares de gráfico em 2 colunas, widget central/tabela em largura total). **Alinhado com o template.**

## Gaps identificados (componentes que NÃO existem e precisamos discutir se criamos)

1. **Filtro de período (DateRangePicker)** — não existe. Precisa de: presets (Hoje, Ontem, 7d, 30d, Este mês, Mês passado, Personalizado) + calendário range. Componente novo necessário.
2. **Seletor de marca (Wepink/Wpink)** — pode ser um `SegmentedControl` simples (2 opções). Verificar se `Tabs` serve ou se criamos um `Segmented` dedicado. O AnalyticsDashboard já tem um segmented inline (linhas 100-114) que pode virar componente.
3. **Seletor de filial multi-select no header global** — existe um combo hoje (mencionado pelo usuário), precisa ser melhorado para multi-select com chips. Verificar estado atual.
4. **KPI Card comparativo rico** — o `StatCard` atual tem delta simples. Para gestor sênior queremos às vezes: valor atual + vs meta + vs período anterior + sparkline. Pode precisar de uma variante `StatCardRich` ou composição.
5. **Tabela com barra de progresso inline** (ex.: "avanço na escada" das metas — ver dashboard-metas01.png) — DataTable + ProgressBar compostos. Não é componente novo, é padrão de composição.
6. **Card de meta com escada/faixas** (dashboard-metas01.png mostra "Avanço na escada" com segmentos) — componente novo: `GoalLadder` ou similar. Mostrar faixas de comissão atingidas.
7. **Indicador de tendência textual** ("subindo"/"caindo"/"estável" com mini-spark — ver dashboard-metas01.png) — pode ser composição de Sparkline + Badge.
8. **Ponto de atenção / alerta inline** ("PA 1,63 · 4% abaixo", "Preço R$ 64,44 · 5% abaixo") — Badge variante warning/danger com métrica. Composição.

---

## Proposta de arquitetura de componentes por subtela (DISCUSSÃO — não implementar)

### Princípio reitor
Cada widget do dashboard = **Card** contendo: título + (opcional) ação de drill + corpo (chart/tabela/KPIs). Reusar `Card`/`CardHeader`/`CardTitle`. Nunca criar wrapper novo se `Card` resolve.

### Submenu 1 — Visão Geral (resumo executivo)
Widgets propostos:
- **KPI row** (4 `StatCard`): Faturamento, Lucro Bruto, Ticket Médio, Margem %. Cada um com delta vs mês anterior + sparkline 30d. → 100% reusa `StatCard` + `Sparkline`.
- **Meta da rede** (1 card grande): `Gauge` ou `RadialProgress` mostrando % da meta mensal + valor atual/target + projeção de fechamento. → reusa `Gauge`/`RadialProgress`. Gap: projeção de fechamento (precisa de cálculo, não de componente).
- **Evolução faturamento** (`AreaLineChart` com `compareData` = mês/ano anterior). → reusa direto.
- **Ranking de lojas** (`DataTable` simplificada ou lista com `ProgressBar`): loja, faturamento, % da meta, tendência. → composição `DataTable` + `ProgressBar`.
- **Alertas / Pontos de atenção** (card com lista): lojas abaixo do ritmo, produtos em ruptura, vendedores atrás da meta. → `Timeline` ou lista com `Badge` danger. Responde "onde preciso agir?".

Pergunta de decisão que esta tela responde: "Minha rede está saudável hoje? Onde está o problema?"

### Submenu 2 — Financeiro
Widgets propostos:
- **KPI row**: Receita, CMV, Lucro Bruto, Margem %, Ticket Médio, Nº de vendas. → `StatCard`.
- **DRE simplificado** (card): tabela vertical Receita → (-) CMV → (=) Lucro Bruto → (-) Despesas → (=) Lucro Líquido, com % sobre receita. → `DataTable` ou composição custom. Gap: talvez um componente `WaterfallChart` (cascata) seria ideal para DRE — **não existe**. Discutir se vale criar ou usar `StackedBarChart` adaptado.
- **Evolução receita vs despesas** (`AreaLineChart` 2 séries). → reusa.
- **Margem por categoria** (`DonutChart` ou `BarChart` horizontal). → reusa.
- **Fluxo de caixa projetado** (`AreaLineChart` com linha de saldo). → reusa.
- **Contas a vencer** (lista/tabela com badges de vencimento). → `DataTable` + `Badge`.

Pergunta: "Estou ganhando ou perdendo dinheiro? Onde vaza margem? Tenho caixa?"

### Submenu 3 — Equipe
Widgets propostos (com toggle Equipe geral ↔ Por turno):
- **KPI row**: Vendas totais, Comissão projetada, Meta atingida %, Produtividade (R$/vendedor). → `StatCard`.
- **Ranking de vendedores** (`DataTable` rica — inspirada em dashboard-metas01.png): vendedor, dias trabalhados, avanço na escada (`ProgressBar` segmentada), ponto de atenção (`Badge`), comissão atual + próximo degrau. → composição `DataTable` + `ProgressBar` + `Badge`. **Este é o widget mais importante da tela** — replica a referência dashboard-metas01.png.
- **Distribuição por faixa de comissão** (`DonutChart` ou `BarChart`): quantos vendedores em cada faixa. → reusa.
- **Por turno** (quando toggle ativado): `Heatmap` vendas por dia-da-semana × hora, ou `StackedBarChart` por turno. → reusa `Heatmap`/`StackedBarChart`.
- **Projeção de comissão** (card numérico): quanto vou pagar se fechar assim. → `StatCard` grande ou card custom.

Pergunta: "Quem bate meta? Quem precisa de ajuda? Quanto vou pagar de comissão? Qual turno produz mais?"

### Submenu 4 — Produtos
Widgets propostos:
- **KPI row**: SKUs ativos, Ruptura %, Dias médios de cobertura, Giro de estoque. → `StatCard`.
- **Top sellers** (`DataTable`): produto, qty, receita, margem, tendência. → reusa (idêntico ao pattern do AnalyticsDashboard).
- **Curva ABC** (`DonutChart` ou `AreaLineChart` cumulativo): A/B/C por participação. → reusa.
- **Produtos em ruptura / estoque baixo** (tabela com badge danger + dias de cobertura). → `DataTable` + `Badge` + `ProgressBar`. Responde "vou perder venda por falta?".
- **Produtos em queda** (lista com delta negativo). → composição.
- **Margem por SKU/produto** (`BarChart` horizontal ordenado). → reusa.

Pergunta: "Quais são meus 80/20? Estou perdendo venda por ruptura? O que descontinuar?"

---

### Padrões de composição reutilizáveis (criar como snippets, não componentes novos)
- **KPI Row** = grid de `StatCard` (já visto em AnalyticsDashboard).
- **Widget Card** = `Card` > `CardHeader`(`CardTitle` + ação) > corpo.
- **Tabela com progresso** = `DataTable` cuja coluna renderiza `ProgressBar`.
- **Alerta inline** = `Badge` variant danger/warning + texto + métrica.

---

## Estado atual dos filtros (mapeado no código)

### Já existe e funciona:
- **`useScope()`** (`src/pages/dashboard/useScope.ts`) — hook que centraliza o escopo (loja, período, divisão/marca) e **persiste na URL** via `useSearchParams`. Estado compartilhável, bookmarkable, sobrevive a reload. Storage key: `wedash.store`.
 - `filialIds`: `[]` = rede; `[id]` = uma loja
 - `periodo`: presets `hoje | ontem | 7dias | esteMes | mesPassado | personalizado`
 - `divisao`: `WEPINK | WPINK | null`
- **`StorePicker`** (`src/pages/dashboard/StorePicker.tsx`) — single-select com avatars no Topbar.
- **`Topbar`** — nas telas do produto (exceto equipe de vendas) → `StorePicker`. O campo **Buscar na WDash** saiu do header (2026-10-04), para gestor, gerente e vendedor. Ctrl+K ainda abre a paleta.
- **`nav-wedash.ts`** — navegação por role (`OWNER` / `MANAGER` / `SELLER` / `ADMIN_GLOBAL`).

### Gaps reais nos filtros (confirmados no código):
1. **Filial é single-select** (`filialId: string`). O usuário pediu **multi-select** (1 ou N lojas). Precisa virar `filialIds: string[]` no `Escopo` + UI de chips/multi-dropdown. Impacta `useEscopo`, `SeletorLoja`, serialização URL.
2. **Não há UI de período/divisão dentro das subtelas ainda** — o `useEscopo` suporta, mas não vi um componente `FiltroPeriodo` / `SeletorMarca` renderizado dentro das páginas do dashboard. O `SeletorLoja` está no Topbar (correto, é o filtro global), mas período e marca precisam de controles **dentro de cada subtela** (como o usuário pediu).
3. **Período "personalizado"** existe no tipo mas **não há DateRangePicker** implementado — só o preset. Precisa do componente de calendário range.
4. **Divisão/Marca (WEPINK/WPINK)** existe no escopo mas **não há SegmentedControl** visível nas telas para alternar. Precisa do componente + wiring.

---

## Decisões VALIDADAS pelo dono do produto (2026-09-12)

1. ✅ **DateRangePicker** — CRIAR componente Vela (`src/components/ui/DateRangePicker.tsx`) com presets + calendário range custom.
2. ✅ **Segmented (WEPINK/WPINK)** — CRIAR componente `Segmented` reutilizável (extrair pattern do AnalyticsDashboard).
3. ✅ **StorePicker → single-select com avatars** (REVERTIDO de multi-select, 2026-09-16) — padrão Vela "Select with avatars": loja = Avatar + fantasia + CNPJ; "Todas as lojas" sem avatar. Escopo continua `filialIds: [] | [id]` (vazio = rede). Comparar N lojas no filtro deixou de ser requisito.
4. ✅ **WaterfallChart (DRE)** — CRIAR chart em cascata (`src/components/charts/WaterfallChart.tsx`).
5. ✅ **CommissionLadder (escada de faixas)** — CRIAR componente dedicado (`src/components/charts/CommissionLadder.tsx`). É o core da tela Equipe.
6. ✅ **Granularidade temporal — REGRA CORRIGIDA**: NÃO é a marca que define o eixo. **É o PERÍODO**:
 - Período de **1 dia** (Hoje / Ontem / personalizado de 1 dia) → eixo por **HORA**.
 - Período de **2–31 dias** → eixo por **DIA**.
 - Período de **> 31 dias** → eixo por **MÊS**.
 - Cards de série mostram subtítulo (`Hoje · por hora` / `… · por dia` / `… · por mês`).
 - Snapshots (KPIs, Formas, Custos…) não usam subtítulo de eixo.
 - Exceções: **Dia da Semana** oculto em 1 dia; **Evolução Mensal** só aparece em período mensal pelo calendário (ver #30; 2026-09-26); **Resultado** rateia custos fixos em hora/dia.
7. ✅ **Ordem de execução** — (a) refinar em texto + mock ASCII no WDASH.md primeiro; (b) começar pela tela **EQUIPE**; (c) depois Financeiro e Produtos; (d) **Visão Geral por último** (é o resumo de todas). Nav+router como esqueleto antes dos componentes.
8. ✅ **Equipe ≠ Grupos** (2026-09-17) — telas SEPARADAS (indivíduo vs operação por grupo). Chrome Equipe: Período + Grupo — **sem filtro de Marca** (2026-09-18: marca não impacta meta/escada/desafios; view força `divisao: null`).
9. ✅ **Turno → Grupo** (2026-09-17) — nomenclatura de produto: `GruposPage`, `montarGruposView`, `paths.grupos`, tipos `Grupo`/`grupoId`. URLs legadas `/dashboard/turnos` e `/configuracoes/turnos-e-tarefas` redirecionam.
10. ✅ **TipHelp (?)** (2026-09-18) — só em jargão / comportamento não óbvio (CMV, P.A., Curva ABC, Resultado rateado, Custos, Escada, Desafios, Total da tabela). Remover quando o título já explica (Faturamento, Nº vendas, Ticket, Lucro bruto, Formas, etc.).
 - **Mesmo indicador = mesmo tooltip em todas as telas** (2026-09-28): textos únicos em `dashboard.ts` — `TIP_CMV` "Custo das mercadorias vendidas no período." · `TIP_CMV_INDISPONIVEL` "O CMV não está disponível para este período." (quando o valor é "—") · `TIP_LUCRO_BRUTO` · `TIP_MARGEM`. Vale para Visão geral, Financeiro e Produtos. Tooltip nunca cita relatório, código ou caminho interno.
 - **Exceção: faixa WPINK do Financeiro** (2026-10-01, decisão do dono) — mesmo significado, mas citando a marca para não parecer o total da operação: `TIP_CMV_WPINK` "Custo das mercadorias WPINK vendidas no período." · "O CMV WPINK não está disponível para este período." · `TIP_LUCRO_BRUTO_WPINK` "Valor que permanece do faturamento WPINK após descontar CMV e impostos." · `TIP_MARGEM_WPINK` "Percentual do faturamento WPINK que permanece como lucro bruto após CMV e impostos."
11. ✅ **Financeiro — Custos antes de Formas** (2026-09-18) — ordem: Custos da Operação → Formas → (opcional) Faturamento por Marca. Donut de marcas só com filtro "Todas as marcas". Custos variáveis (aluguel %, royalties, marketing) calculados só sobre a(s) marca(s) do filtro; linhas da outra marca ocultas.
12. ✅ **Desafios só Ativo** (2026-09-18) — Dashboard > Equipe e Ao vivo listam apenas `statusLabel === "Ativo"` (sem Encerrado / A começar). Premiação do KPI ainda pode considerar desafios da competência que já fecharam.
13. ✅ **Progresso da Meta = faturamento da loja** (2026-09-18; **revisto 2026-09-25**) — `metaGlobal.realizado` = faturamento da loja na competência (igual à Visão Geral; rede = soma das lojas). Venda sem vendedora e de gerência (#36) contam na meta da loja, mas ficam fora do ranking/premiação; a faixa mostra "Inclui R$ X de vendas sem vendedora ou de gerência (fora do ranking)" (`foraDaEquipe` = loja − Σ vendedoras). Antes era a soma do ranking. Demo de ritmo só redistribui o bolo real (sem inventar R$). Nível/degrau na UI = MTD (o que já garantiu); projeção alimenta só premiação projetada. Escada padrão tipicamente Meta 50% → Super 75% → **Hiper 100% (= meta da loja)** → Desafio 110% (configurável na tela de Metas). Mock set/26: Shopping CG (f1) no Hiper (N3 ≈100%); vendedoras espalhadas N1–N4.
10. ✅ **Dashboard > Grupos removido** (2026-10-05; pausado em 2026-09-17) — fora do menu; `/dashboard/grupos` redireciona para a Visão geral. A tela e a camada `buildGroupsView` saíram.
11. ✅ **Metas fora do Dashboard** (2026-09-17) — item de menu abaixo do Dashboard (`/metas`). Saiu de Configurações; URL legada `/configuracoes/metas` redireciona. Esqueleto em `src/pages/metas/MetasPage.tsx` (listagem fixture; CRUD amanhã).
12. ✅ **Onboarding = 1. Crie seu acesso → 2. Integração ERP → board** (2026-09-28; substitui o "Crie sua senha" só com senha de 2026-09-27 e a espera da sincronização na etapa ERP) — sem etapa Empresa e **sem etapa Lojas**: ao conectar, todas as lojas que o usuário Millennium enxerga entram sozinhas (aparecem no StorePicker). Usuário sem loja vinculada → toast de erro no ERP + logout da sessão de teste.
 - Após login com a senha temporária: tela **"Crie seu acesso"** (`/create-access`, `CreateAccess.tsx`; `/create-password`, `/change-password` e `/trocar-senha` redirecionam) = **Nome · Sobrenome** (sempre em branco — o convite só traz o e-mail; mín. 2 letras cada, Title Case ao gravar) + nova senha + confirmação. Botão "Salvar e continuar" → "Salvando…" → toast "Acesso criado." (`createAccess` em `authApi.ts`: grava `first_name/last_name/name` na identity antes da senha). E-mail não aparece (só um campo invisível `autocomplete="username"` para o gerenciador de senhas).
 - **Etapa ERP = 1 botão "Testar e conectar"**: testa login + lojas + relatórios personalizados; passou → grava credencial e lojas ("Conectando…"), fecha o onboarding no banco, pede as vendas de hoje (SEED, `requestTodaySync` em `src/data/wedash/initialSync.ts`) **sem esperar**, toast "Millennium conectado." e abre a **Visão geral em Hoje zerada**. Falha ao gravar → toast de erro, desloga a sessão de teste e fica na etapa. O onboarding não usa mais `/sincronizando` (segue só na troca de usuário ERP sem lojas em comum).
 - **Aviso no board** (`InitialSyncNotice` + `useInitialSync`, Visão geral · Financeiro · Produtos, acima do aviso da carga do histórico): SEED rodando = "Buscando as vendas de hoje · Os dados aparecerão automaticamente…" (**na fila sem o worker = sem aviso**, só confere — com `SYNC_ONBOARDING=off` o worker só traz o cadastro (equipe, produtos) e encerra o SEED sem vendas; poll 3s; ao terminar dispara `SALES_SYNCED_EVENT` e as telas recarregam); na fila > 90s = aviso amarelo (sincronizador sem responder); falhou = alerta vermelho + **Tentar novamente** (usuário ERP logado em outro lugar tem texto próprio). Um Atualizar (FORCE) posterior ao SEED encerra o aviso.
 - **Foto de perfil opcional no "Crie seu acesso"** (2026-09-28): `CampoFoto` (`AccessKit.tsx`, padrão da aba Profile do template — quadrado 88px com iniciais do nome digitado + botão "+", "Remover foto") centralizado acima de Nome · Sobrenome. `createAccess` sobe a foto **antes** de gravar nome/senha (falhou → toast, nada muda; dá para remover e seguir) e grava `avatar_url` junto com o nome. Convite do Gerente ainda sem foto. Troca de foto em Meu perfil ainda a fazer. Peças: coluna `identity.avatar_url` (migration `20260927140000_identity_avatar`), bucket Storage público `avatars` (`{auth.uid}/{timestamp}.jpg`, RLS por pasta, 1 MB), `uploadAvatar` (`authApi.ts`) + `prepararAvatar` (`src/lib/avatar.ts`: quadrado 512px JPEG), `Avatar` do Vela com `src` (cai nas iniciais) já usado no Topbar e no Meu perfil.
 - **"Crie seu acesso" é a etapa 1 do indicador do onboarding** (`ONBOARDING_STEPS` em `src/pages/onboarding/steps.ts`: Crie seu acesso · Conecte o Millennium), mesmo shell do wizard (marca + Sair, hero com checklist). Indicador só para quem ainda tem onboarding (dono). `onboarding_step` no banco = 2 (ERP); 1 (legado Empresa / seed) e 3 (legado Lojas) caem no ERP. Teste: `node scripts/reset-first-access.mjs email --onboarding` reabre acesso + ERP (mesmo usuário Millennium = sem perda de dados). Nome da empresa (`tenant.name`) = o do cadastro feito pela WDash (só aparece no convite e no perfil).
 - **Convite de Gerente = só o e-mail** (modal Convidar usuário sem campo Nome). `/invite/:token` = mesma tela "Crie seu acesso" (Nome · Sobrenome em branco + senha; "…para acessar a WDash como gerente da EMPRESA."). Edge `team-members`: `invite` grava a identity com nome vazio; `accept` exige nome e sobrenome (`invalid_personal_data`) e grava `first_name/last_name/name` ao ativar. Configurações > Usuários mostra o e-mail no lugar do nome enquanto o convite não é aceito. Template "Invite user" do Supabase não tem mais `{{ .Data.name }}` (só `company` e `role`).
 - Reset de teste para primeiro acesso (sem apagar dados): `node scripts/reset-first-access.mjs email@…`.
 - Onboarding sem Equipe (2026-09-19): sync de funcionários sai do onboarding (precisa explicar cadastro no Millennium); Edge `millennium-onboarding` só login/filiais/logout (sem FUNCIONARIOS.Lista).
13. ✅ **Sessão ERP ligada ao usuário WDash (persistente)** (2026-09-21) — No onboarding vinculamos credencial Millennium ao tenant. O token fica em `erp_credential.millennium_session` e **renova enquanto a integração estiver ativa**. Worker **reusa** o token (só faz login se não houver / 401); **não** desloga ao fim de cada job nem no Ctrl+C. Logout explícito só em **Configurações > Integração ERP** (`Desconectar` = pause + release) ou `npm run erp -- pause`. Ideal: usuário ERP dedicado à WDash. **Usuário Millennium = caixa alta** (UI + gravação + login).
14. ✅ **VENDAS.Lista em paralelo por loja** (2026-09-21; **adaptativo 2026-09-23**) — 1 login / 1 `WTS-Session`. Default = **todas as lojas do job em paralelo**; se Millennium der busy/timeout, desce N→⌊N/2⌋→1 e retenta. `STORE_CONCURRENCY` opcional só como teto. LIGHT: 1× Lista sem filial. FORCE: Product map só se alguma loja tem WPINK; janela LISTAR = hoje (não mês ant.).
15. ✅ **Onboarding: token sobrevive até o SEED** (2026-09-21/22) — etapa ERP testa e, ok, **persiste** usuário/senha/token + todas as lojas numa chamada e enfileira o SEED **sem** logout (2026-09-27: sem etapa Lojas). Logout só no teste sem lojas / Desconectar. Troca de username ERP no **onboarding** apaga dados de sync do tenant; em **Configurações > Integrações** a troca compara lojas (ver #27).
16. ✅ **Botão Atualizar (FORCE)** (2026-09-21; **só hoje 2026-09-23**) — janela = **hoje** (fuso da loja), independente do filtro de período da tela. Escopo = loja do StorePicker (`storeIds`); “Todas” = rede. **Sem cooldown** (`FORCE_COOLDOWN_MS = 0` no client `syncUi.ts` e na Edge `erp-sync-enqueue`) — gestor pode clicar de novo quando quiser. FORCE bem-sucedido grava `last_light_sync_at`. Worker: 1 job RUNNING/credencial (fila), escopo por loja no payload.
 - **LIGHT automático OFF** (2026-09-23) — worker não enfileira sync de 5 em 5 min. Só **Atualizar (FORCE)** (+ SEED do onboarding). RANGE/BACKFILL na fila são descartados (`SYNC_MANUAL_ONLY`, default on). Religar LIGHT: `LIGHT_AUTO=1`. HISTORY automático **removido** (2026-09-25) — histórico = carga dia a dia pós-onboarding (`SYNC_ONBOARDING`, ver #23c).
 - **FORCE loja por loja, relatórios em paralelo** (2026-09-24): "Todas as lojas" = filial por filial (termina todos os relatórios de uma antes da próxima). Dentro da loja rodam ao mesmo tempo 3 frentes: (Lista → marca/CMV via margem → DetMov) ‖ categorias `{2C46ADF5}` ‖ top produtos `{E7A5C5C7}` — no máx. 3 chamadas simultâneas ao ERP. Marca/CMV fica depois da Lista porque usa as vendas. Medido (2026-09-24): 3 lojas em 8,4s (~2–2,5s/loja). SEED (onboarding = hoje), carga do mês e fechamento noturno = este mesmo FORCE rodado dia a dia. Vale também para o fechamento noturno (usa o FORCE por dentro).
 - **Log do worker (terminal)** (2026-09-25, `jobLog.ts`): cabeçalho (título do job · dia · N lojas · **usuário ERP** + sessão reaproveitada/nova · tenant/job · hora de início) → 1 bloco por loja (`▶ Loja 1/3 · código · nome · faltam ~X`, linha de fatos `N vendas · R$ · WPINK R$ · N cupons no relatório`, `✓ tempo · N chamadas ao ERP (por relatório)`) → resumo (`✓/✗ Título concluído · lojas · tempo total · chamadas`, início/fim, usuário ERP, tempo por loja, chamadas por relatório, motivo se falhou). Linhas técnicas por etapa só com `SYNC_LOG_VERBOSE=1`; avisos e erros sempre aparecem. Horários usam o relógio real (o CLOSE roda com relógio no fim do dia). **Terminal em ASCII só no Windows** (`consoleAscii.ts`; no Fly o log fica em português, com acento); layout com `=`/`-`, `[1/3] Loja …`, `OK`/`AVISO`/`ERRO`, separador `|`. Logs gravados no banco (tela Logs) seguem com acento. **Carga em período** (2026-09-25): 1 cabeçalho (período · lojas · "ERP 1x por loja no período") → 1 linha por dia gravado (`[1/31] 31/08/2026 | N vendas | R$ | tempo`, + chamadas ao ERP só quando houve — normalmente o 1º dia) → resumo (dias · tempo · chamadas por relatório). Sem blocos por loja (`SyncJob.compactLog`); avisos e erros continuam aparecendo.
 - **Atualizar sem chamada repetida** (2026-09-26): (1) **Clique repetido** — Edge `erp-sync-enqueue` devolve o FORCE manual QUEUED/RUNNING que já cobre as lojas pedidas (`deduped`; "Todas" cobre loja; loja não cobre "Todas"; rodada automática fica de fora) e o botão acompanha esse job. (2) **Sem venda nova** — worker guarda em memória a impressão digital da Lista de hoje por loja (`listaFingerprint.ts`: vendas, NF, hora, R$, itens, forma, vendedora); Lista igual à da última rodada **completa e sem aviso** → pula Produtos por cupom e Marca/CMV (1 chamada em vez de 3; medido: 12 → 4 chamadas nas 4 lojas). Com impressão digital salva o cupom espera a Lista (~0,4s a mais só quando houve venda). Rodada que fecha o dia (`fullStoreIds`) e dias passados sempre completos. Reiniciar o worker = 1ª rodada de cada loja completa. **Sem cache por tempo** (manteria o "clica quando quiser").
 - **FORCE faz:** Lista + formas + marca/CMV via margem (`WP*`) + categorias `{2C46ADF5}` **só de hoje**. **Não faz** Product map LISTAR nem TOTAL VENDA POR DIA. Dia anterior → **fechamento noturno** (#23b); meses antigos → planilha (futuro).
 - Categorias: sync **ligado** em SEED/HISTORY/FORCE/RANGE (`shouldSyncCategories`); LIGHT não.
17. ✅ **Sync NÃO depende de presença WDash** (corrigido 2026-09-22) — Claim/LIGHT **ignoram** `wedash_present_at`. Sair da WDash **não** pausa o Millennium. Desconectar ERP = só em Integração ERP. Contrato de jobs:
- **SEED** — **só hoje** (2026-09-24) = o Atualizar (FORCE) de hoje; o botão da etapa Integração ERP fica "Sincronizando…" até hoje estar gravado (segundos). O resto do mês = **carga do mês** por trás (ver #23c). Passado → planilha (futuro).
 - **LIGHT** — hoje; **1×** Lista **sem** filial; particiona por `FILIAL` da linha.
 - **HISTORY** — só manual (`scripts/history-months.ts`); na fila é descartado.
 - **FORCE** — **só hoje**; com filial.
 - **EVENTO** — whitelist `S-X`, `S-03`, `S-{COD_FILIAL}` (**sem S-100**). Mapa `código → id` em `erp_sales_evento` (1× `EVENTOS.ListaTodos` por tenant); FORCE/LIGHT só re-buscam se faltar o código da loja.
18. ✅ **Split WEPINK/WPINK** (2026-09-22; **margem WP* 2026-09-23**) — `VENDAS.Lista` **não** traz marca. Após gravar `brand=ALL` (Lista), o worker:
 1. **Receita/dia × marca** via `RELATORIOMARGEM` (`COD_PRODUTO` `WP*` → WPINK; resto → WEPINK; `TOTALVENDA`). Bate 0% com o antigo wtsreports **TOTAL VENDA POR DIA** `{70F9DE61}` (retirado do FORCE).
 2. **CMV** no mesmo fetch da margem (não re-chama nos dias já cobertos).
 3. **Contagens (nº vendas / itens)** — DetMov day agg quando a loja tem WPINK; loja só cosmético copia counts do ALL → WEPINK. Overview rateia do ALL se counts ainda forem 0 (dados antigos).
 4. Mapa produto (estoque `{9701602B}` + LISTARVENDASSALDO 101/102 + lookup COD→id) + **ConsultaDetMov** → horas (e fallback se a margem cair). Classificação DetMov: mapa → desc (WP*/WPINK/WEPINK) → default WEPINK.
 Soft-fail se margem/detalhe cair (ALL permanece). BrandPicker reativa quando existem linhas WEPINK/WPINK. Concurrency DetMov: `DET_MOV_CONCURRENCY` (default 5).
 5. **Cache de cupons do DetMov** (2026-09-24, migration `20260924230000_sales_coupon_brand`) — tabela `sales_coupon_brand` (loja × cupom `COD_OPERACAO|NF|TIPO`: dia, hora, R$ e itens WEPINK/WPINK). Todo job (Atualizar, fechamento noturno, SEED) lê o cache do período, chama o ConsultaDetMov **só dos cupons que faltam** e grava os novos. Contagens e horas por marca = cupons da **Lista atual** (cache + novos) — cupom cancelado sai da soma sozinho. Detalhe vazio não entra no cache (pode ser falha momentânea). Só o worker acessa (RLS sem policy; service_role). Log: `DetMov N NF · X no cache · Y a buscar`.
19. ✅ **CMV na Visão Geral** (2026-09-23; **por marca via WP***) — fonte `MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM`.
   - **Nome no ERP (UI / path):** `FRANQUIAS > RELATORIOS > RELATORIOMARGEM` (`CUSTO_TOTAL` = `CUSTO_FRANQUIAS × QTDE`).
   - Grava `cmv_cents` em **ALL** (patch) e em **WEPINK/WPINK** (mesmo fetch, `COD` WP*). Faturamento ALL = Lista; marca = TOTALVENDA da margem.
   - **DATAI/DATAF = calendário inclusivo** (a `VENDAS.Lista` também: desde 2026-09-25 `milleniumDataRange` manda DATAF = o próprio último dia; antes mandava a meia-noite do dia seguinte e cada dia passado trazia o dia seguinte inteiro junto — gravação filtrava pela data, mas a loja com WPINK buscava o detalhe desses cupons à toa).

20. ✅ **Categorias (mix Overview)** (2026-09-23) — card **Faturamento por categoria** na Visão Geral. **Desde 2026-09-25 a fonte é o catálogo de produtos (#34)**; o relatório abaixo foi desligado.
 - **Report (personalizado):** **WEPINK - FATURAMENTO POR TIPO DE PRODUTO** `{2C46ADF5-4B28-4C72-95B5-759C5BA026E4}` — 1 call/dia já agregado por tipo.
 - **Filtros:** Data · Filial · Divisão · Tipo · Funcionário.
 - **Campos:** `PRODUTO_TIPO_TIPO` → `category_id`; `PRODUTO_TIPO_DESCRICAO` → nome; `F_366619977` receita; `F_3887607047` qty.
 - Sync: SEED/HISTORY/FORCE/RANGE (`shouldSyncCategories`); FORCE refresca **hoje**. Soft-fail se o personalizado faltar.
 - Meta por categoria → CRUD de Metas (ainda não).
 - **Check Onboarding** do personalizado → TODO #22.

20b. ✅ **Formas de pagamento** (2026-09-23) — `CONDICAO` da `VENDAS.Lista` (sem relatório novo).
 - Tabela `sales_payment_day_agg` (loja×dia×forma, brand=ALL).
 - Worker grava em SEED/HISTORY/FORCE/LIGHT (replace no range da janela).
 - Overview: donut + lista; rótulos Pix / Cartão de crédito / Cartão de débito / Dinheiro / Outros, **exibidos em caixa alta** (PIX, CARTÃO DE CRÉDITO…; 2026-09-29, `labelUpper` na tela — Visão geral e Financeiro; dados e cores seguem com o rótulo original).
 - **Venda individual do fechamento de caixa** (2026-10-08): `cash_close_sale` guarda cada venda da Lista com valor, forma, vendedor e hora. O agregado `sales_payment_day_agg` e o faturamento não mudam. Dias anteriores a essa gravação não são reescritos. **Sem cruzamento (2026-10-09, decisão do dono):** o fechamento não cruza venda a venda. A tela mostra se houve quebra ou sobra. O desconto continua manual, fora da WDash.
 - **Valor digitado** (2026-10-08): `MILLENIUM!FRANQUIAS.RELATORIOS.FECHAMENTOCAIXADETALHADO`, GET com corpo `DATAI`, `DATAF` e `CONTA`. Um dia = as duas datas na meia-noite local (`2026-10-07T04:00:00.000Z`). A `CONTA` sai de `millenium.CONTAS.Lista_Caixas` (`FILIAL` e `IMPR_FISC` nulos). Cada filial tem o caixa (`NUMERO` = código da loja, ex.: `00386` → `CONTA` 101231) e a conta de compras (`NUMERO` com sufixo `-1`). O fechamento usa só o caixa. O id interno da conta não é o `millennium_store_id`. Cada linha vai para `cash_close_day`: `FORMA_PAGAMENTO`, `ENTRADA_INICIAL`, `VALOR_SANGRIA`, `VALOR_FECHAMENTO`, `VALOR_DIGITADO_FECHAMENTO`. Diferença = fechamento − digitado. TEF crédito e TEF débito ficam separados do cartão. Loja sem caixa nessa lista não grava valor digitado. O faturamento não muda.
 - **Stone** (2026-10-08): arquivo de conciliação XML 2.2, um Stone Code por dia, depois das 5h do dia seguinte. Chave cifrada em `store_stone` (só o worker lê). `stone_capture` guarda a captura do dia (não a liquidação de venda anterior). Contas 2 e 4 = crédito (4 é crédito pré-pago); contas 1 e 3 = débito (3 é débito pré-pago). Crédito, débito e Pix somam cada um na sua forma. Voucher e boleto continuam em Outros. A loja 00386 (LOJAWEPINK.CENTRO.CAMPOGRANDE, Stone Code 793900709) usa só Stone (`covers=all`). No dia 07/10 o crédito e o débito bateram com o fechamento do Millennium; o PIX desse dia não veio no arquivo.
 - **PIX Stone** (2026-10-08): CSV separado, pedido pelo CNPJ (`POST .../conciliation-file/pix/{AAAA-MM-DD}`) depois das 5h de Brasília, na janela do fechamento da madrugada (ontem e anteontem). Vale para cada loja em `store_stone` (Stone Code e chave próprios; o aviso casa o CNPJ com uma loja). A Stone avisa `POST /hooks/stone/pix/{token}` com o link; a rota responde na hora e grava `stone_pix`. Sem esse endereço confirmado, a Stone recusa o pedido na hora. O valor no CSV já vem em centavos inteiros (1000 = R$ 10,00). O pedido do CSV só sai no dia em que o Millennium registrou venda de Pix; dia sem essa venda fica no log como `sem venda de Pix no Millennium`. O extrato de cartão (crédito e débito) só sai no dia com crédito ou débito gravado; dia sem nenhuma venda fica no log como `sem venda no Millennium` e não pede arquivo. A carga do histórico e o fechamento já percorrem cada dia da janela, sem buraco. Quando um desses dias ganha venda, o arquivo entra nessa mesma passagem. Quando o CSV chega, o log traz a quantidade de eventos e o total em reais. O calendário usa o mesmo total do detalhe (`stone_pix`). Se o endereço já estava cadastrado, o worker atualiza o mesmo aviso para a Stone confirmar de novo. Na subida, só pede essa confirmação depois que o endereço público responde. Ao conectar a Stone, entra na fila do dia 1 do mês atual até ontem. O dia de hoje fica para a madrugada seguinte. Mês anterior não entra nessa conexão: a madrugada pega, um dia por vez, o dia que já tem venda e ainda não tem fechamento. O nome `wdash-millennium-sync.fly.dev` precisa de um IP público no Fly. Pedido sem CSV volta a ser feito depois de 45 min, ainda dentro da janela. O faturamento não muda.
 - **Fechamento de caixa** (2026-10-08): **Fechamento** no menu Gestão (Gestor e Gerente). O card Stone fica em Custos > Adquirentes (só Gestor): a chave é da loja, não da empresa. Adquirentes = card Stone no desenho do Millennium (Stone Code e chave cifrada), uma loja por vez. Cobertura padrão é cartão e PIX (`covers=all`); a tela não pergunta. Conectada, a chave aparece mascarada e os campos ficam só leitura; **Desconectar** apaga a linha de `store_stone` (para de buscar cartão e PIX; o que já foi gravado permanece). Trocar código ou chave = desconectar e conectar de novo. Ao conectar, pede o mês. Fechamento = calendário no formato do Vela. O campo de mês (**Outubro de 2026**, com card para escolher o ano e o mês) e as setas ficam no cabeçalho da tela, no mesmo lugar do período das demais telas. O mês começa no atual. O Atualizar do cabeçalho, com esta tela aberta, pede o mês que está no calendário. Acima da grade: diferença (sobra ou quebra só dos dias que já têm total real) e dias pendentes (amarelo: dia passado sem total real). O total digitado saiu dessa faixa. Dia sem registro fica em branco. O dia de hoje mostra o faturamento das vendas, o mesmo da Visão geral, sem selo. Do dia anterior para trás, o valor vem do fechamento de caixa. Dia passado sem total real fica Pendente, com o total do Millennium. Dia com total real mostra esse total; sobra é selo verde com `+` e falta é selo vermelho com `−`. Se fechou igual, fica só o total. O valor positivo ou negativo começa em D-1. No detalhe, a sobra fica só na coluna Diferença. Clicar no dia abre o detalhe num modal, com a conta do dia (total real − Millennium = diferença) acima da tabela. A tabela do dia tem Forma, Millennium, Total real e Diferença. A diferença de cada linha é total real − Millennium, com sinal de sobra ou quebra. Forma sem total real fica em branco, não vira R$ 0,00 e não entra na diferença. O dia continua Pendente até o arquivo ou o lançamento manual. Sem adquirente, o gestor grava o total real de crédito, débito, Pix e outros; dinheiro continua só leitura. O rodapé soma as colunas. No detalhe do dia de hoje aparece só o faturamento das vendas, o mesmo da Visão geral. A tabela por forma entra no dia seguinte. Dia com diferença positiva não pede justificativa. O total real das formas da adquirente começa com o arquivo quando ele chegou; o gestor pode alterar esse número e o valor gravado substitui o arquivo. Em dinheiro o total real é o valor digitado no Millennium e fica só leitura. Esses ajustes ficam em `typed_cents` e `acquirer_cents` de `cash_close_review` e entram uma vez na linha já somada. O Atualizar do cabeçalho pede as vendas de hoje e o mês que está na tela, do dia 1 até ontem (mês já passado: o mês inteiro), só os dias sem fechamento gravado (job `CLOSE` com `cashOnly`, sem rebuscar vendas). Ao terminar, o calendário relê os dias. Abaixo do mês aparece o horário da última busca. O dia de hoje usa o faturamento das vendas. O dia encerrado usa o fechamento de caixa. O PIX desses dias chega pelo mesmo webhook.
 - Histórico só após FORCE (ou próximo SEED) — LIGHT só cobre o dia atual.

20c. ✅ **Top vendedoras** (2026-09-23) — `VENDEDOR_MILLENNIUM` da `VENDAS.Lista` (sem relatório novo).
 - Tabela `sales_seller_day_agg` (loja×dia×seller_key, brand=ALL).
 - Chave = nome normalizado (sem acento, upper); sem nome → fora do ranking (permanece no fat. da loja).
 - Worker grava junto com formas (SEED/HISTORY/FORCE/LIGHT — replace no range).
 - Overview: Top 5 com R$ + nº vendas + ticket + **P.A.** (itens ÷ vendas) + **loja**; **% meta** fica para CRUD de Metas/Colaboradores.
 - **P.A. + loja** (2026-09-26, migration `20260926120000_seller_item_count`): `sales_seller_day_agg.item_count` = Σ QUANTIDADE da Lista. P.A. some ("nada estimado") se algum dia com venda da pessoa não tem itens gravados. Loja = onde mais faturou no período (`+N` se vendeu em outras); só aparece com mais de 1 loja no escopo (com 1 loja no StorePicker é redundante). Agosto e setembro regravados pela carga em período.
 - Preferência de produto: reusar campo da Lista antes de integrar relatório por vendedor.

20d. ✅ **Overview sem filtro de Marca** (2026-09-23) — tela sempre total (ALL).
 - Remove BrandPicker / Segmented WEPINK|WPINK na Visão Geral.
 - ~~Faixa **quick stats WPINK**~~ **removida da Visão Geral e de Produtos (2026-09-26)**: separação por marca = detalhe → fica **só no Financeiro** (faixa WPINK + card Faturamento por marca). A view ainda calcula `kpisWpink`; as páginas não renderizam.
 - Sub do Faturamento WPINK: `X% do faturamento` (não “do total”).
 - KPIs principais = total puro (sem subtítulo WPINK).
 - Demais cards sem anotação de marca.
 - Outras telas do Dashboard: decidir tela a tela depois.

20e. ✅ **Top produtos (Overview)** — fonte **WEPINK - VENDAS DE PRODUTOS POR FILIAL** `{E7A5C5C7-950F-425C-8556-803FE15D92E7}` (personalizado; preferir a DetMov).
 - **1 call** por dia · com `FILIAL_GERADOR_GERADOR` = 1 loja (rede: 1 call/loja; sem filial = todas — otimização futura).
 - Linha = NF × produto → agrega em `sales_product_day_agg` (loja×dia×product_id).
 - Campos: `PRODUTO_PRODUTO_PRODUTO` · `COD_PRODUTO` · `DESCRICAO1` · `F_3887607047` qty · `F_366619977` receita · ignora `CANCELADA`.
 - Data: `INTERVAL=0` + START/END (= dia). Sync SEED/HISTORY/FORCE/RANGE; soft-fail se faltar.
 - Overview Top 5 = R$ + itens + **lucro bruto** (2026-09-30; mesma conta da tela Produtos: faturamento − CMV da margem − ICMS − ICMS ST; "—" se algum dia sem custo; a Visão geral busca `sales_product_cost_day_agg` do período) + variação vs período anterior (quando há agg). Agrupado por `COD_PRODUTO` (igual à tela Produtos).
 - Ordenação (2026-09-24): a view traz o **ranking completo**; a coluna clicada (Qtd / Faturamento / Variação) escolhe **quais 5 entram** (os maiores naquela métrica; empate → faturamento). A seta só inverte a ordem dos 5. "Produto" reordena por nome o Top 5 de faturamento.
 - **Check Onboarding** do personalizado → TODO #22.

### Relatórios Millennium — nomes UI ↔ GUID/path
| Uso WDash | Nome visual no ERP | Identificador |
|---|---|---|
| Marca / dia (WEPINK·WPINK) | **RELATORIOMARGEM** (`COD` WP*) | `MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM` — (legado UI: TOTAL VENDA POR DIA `{70F9DE61}` fora do FORCE) |
| CMV | **RELATORIOMARGEM** (`FRANQUIAS > RELATORIOS`) | `MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM` |
| Categorias (mix Overview) | lookups `PRODUTO.tipo.tipo` + `produto.produto.produto` (PARAM_9) → catálogo (#34) | (legado `{2C46ADF5}` desligado 2026-09-25) |
| Top produtos (SKU Overview) | **WEPINK - VENDAS DE PRODUTOS POR FILIAL** | `{E7A5C5C7-950F-425C-8556-803FE15D92E7}` — personalizado (check Onboarding) |
| Mapa produto→marca (estoque) | report divisão estoque | `{9701602B-B363-4770-989C-8C4459B7E105}` |

21. 🔲 **TODO Configurações > Custos** (não esquecer):
 - ✅ Impostos (2026-09-24): ICMS (% faturamento) + ICMS ST (% CMV) por loja — ver #24b / #30. Validar com o dono se o `CUSTO_FRANQUIAS` do Millennium já traz ICMS ST embutido (senão fica dobrado).
 - Royalties / marketing / aluguel / custo fixo → margem de contribuição (Financeiro v2).
 - CMV por marca (WEPINK/WPINK) — ✅ via margem WP* (2026-09-23).
22. 🟡 **Check de permissão ERP** — ✅ **personalizados feito (2026-09-24)**: onboarding (Step2 "Testar e continuar") e Configurações > Integrações ("Conectar") testam login + lojas + **acesso aos relatórios personalizados**; faltou algum → **bloqueia**, desloga e mostra a lista (✓/✕ + erro do ERP) pedindo liberação ao admin do Millennium.
 - Como testa: Edge `millennium-onboarding` com `checkReports: true` → `checkCustomReports` (`_shared/millennium.ts`, lista `CUSTOM_REPORTS`) chama cada GUID no wtsreports com **filial vazia + 01/01/2000** (resposta leve, ~1s). `200` + `RAW_DATA` = ok; qualquer outra coisa (ex.: 400 "Tipo de documento não suportado") = sem acesso → `reason: "reports"`.
 - Novo relatório personalizado no sync → adicionar em `CUSTOM_REPORTS`.
 - Demo sem Supabase: senha `relatorio` simula falta de acesso.
 - Ainda **sem check**: APIs comuns abaixo (RELATORIOMARGEM, DetMov, lookups) — seguem soft-fail + Logs.
 - **Sem check (uso atual):** `EVENTOS.ListaTodos`, `VENDAS.Lista`, `RELATORIOMARGEM`, `MOVIMENTACAO.ConsultaDetMov` (Detalhe Movimento), `login`, `FILIAIS.Lista`.
 - **Soft-fail hoje / ao ligar Top produtos (checar no Onboarding):**
   - categorias `{2C46ADF5…}` — se faltar, log warn e card vazio.
   - Top produtos `{E7A5C5C7…}` **WEPINK - VENDAS DE PRODUTOS POR FILIAL** — se faltar, log warn e Top produtos vazio.
 - **Checar no futuro** (quando religar product map / etc.):

| Uso WDash | Nome / path no ERP | Quando precisa |
|---|---|---|
| Mapa filial→gerador | lookup `filial.GERADOR.gerador` | Product map / wtsreports |
| Divisão estoque (marca) | wtsreports `{9701602B…}` | Product map (loja com WPINK) |
| Vendas×saldo por tipo | `FRANQUIAS.RELATORIOS.LISTARVENDASSALDO` | Enrich product map |
| Lookup produto | `produto.produto.produto` | Join COD→id do mapa |
| Categorias | wtsreports **WEPINK - FATURAMENTO POR TIPO DE PRODUTO** `{2C46ADF5…}` | Mix Overview — **checar no Onboarding** |
| Top produtos | wtsreports **WEPINK - VENDAS DE PRODUTOS POR FILIAL** `{E7A5C5C7…}` | Overview Top produtos — **checar no Onboarding** |
| (legado categorias) | **WEPINK - PRODUTOS VENDIDOS POR VENDEDOR** `{C5BBF0E2…}` | Substituído pelo `{2C46ADF5}` |
| (legado) | TOTAL VENDA POR DIA `{70F9DE61…}` | Fora do FORCE (margem WP*) |

 Fluxo futuro: Step2 após login → smoke em cada item “Checar” → se faltar, bloquear e pedir liberação no Millennium.

23. ⏸ **Histórico automático (HISTORY)** (2026-09-24) — **REMOVIDO em 2026-09-25**: varredura, encadeamento e `HISTORY_MONTHS` saíram do worker; o histórico agora é a carga dia a dia pós-onboarding com `SYNC_ONBOARDING` (#23c). O registro abaixo fica como contexto. Teste com mês inteiro × 3 lojas em paralelo derrubou a Lista no Millennium ("Requisição cancelada"/timeout) e o volume de chamadas (DetMov = 1 chamada por cupom) arrisca bloqueio do usuário ERP. Em avaliação: **contar só a partir da entrada na WDash** (SEED = mês anterior + atual já dá comparativos e curva da meta) em vez de puxar 24 meses; alternativas = resumo mensal via relatórios de período (sem DetMov) ou importar planilha. Código abaixo fica pronto, mas desligado.
 - **Teto:** `.env HISTORY_MONTHS` = meses **fechados** antes do mês atual (máx. 24; `0`/ausente = desligado). Hoje **2** (set/26 → busca até 01/07); depois sobe para 24.
 - **Chão por loja:** o mais recente entre o 1º dia do mês do teto e a **inauguração** (`store.opened_at`).
 - **Janela:** 1 **mês fechado** por job, sempre o mês antes do dia mais antigo já gravado da loja; ao terminar encadeia o próximo mês. Dias sem venda gravam R$ 0 (o cursor anda mesmo em mês parado).
 - **Disparo:** worker varre a cada 10 min (e no boot) as integrações conectadas; 1 HISTORY por credencial (QUEUED/RUNNING não duplica); nada com onboarding aberto ou integração pausada. Subir o teto → próxima varredura continua para trás.
 - **Prioridade:** fila ordena Atualizar (FORCE) → SEED → HISTORY. O Atualizar só espera se um mês de histórico **já estiver rodando** (1 job por credencial; lojas do mês em paralelo).
 - Não mexe no "Atualizado às…" (`last_light_sync_at`) nem mostra "sincronizando" na UI.
 - **Manual:** `npx tsx scripts/history-months.ts N` (N meses, sem fila) · `npx tsx scripts/force-day.ts YYYY-MM-DD` (refaz um dia).
 - **Estratégia de dados decidida (2026-09-24):**
 - **Onboarding (SEED) = só o mês atual** (2026-09-24, substitui "mês atual + mês anterior enxuto"): dia 1 → hoje, tudo completo (inclui DetMov WPINK). Motivo: a Lista de mês inteiro travava o Millennium (2m42s + "Requisição cancelada", depois timeout). Agora a Lista vai **1 dia por chamada** (~0,6–1,3s); janela de vários dias que falhar (HISTORY/RANGE) é fatiada na hora, sem repetir a consulta grande. Consequência aceita: sem histórico, badges "vs mês passado", curva da meta (6 semanas) e Evolução mensal começam vazios e vão enchendo com o fechamento noturno; nada é estimado.
 - **SEED = só no onboarding** (e na troca de usuário ERP sem nenhuma loja em comum, que equivale a refazer o onboarding).
 - **SEED = Atualizar (FORCE) de hoje** (2026-09-24): roda exatamente o Atualizar (mesmo código do fechamento noturno, `runDailyForceJob`) — loja por loja, 3 frentes em paralelo (Lista → equipe → margem → DetMov) ‖ categorias ‖ top produtos. **Sem mapa de produtos** (marca = margem WP* + descrição no DetMov). Dia sem venda grava R$ 0 (cobertura da tela `/sincronizando`). Falhou = job FAILED + "Tentar novamente". Grava "Atualizado às…" e enfileira a carga do mês (#23c).
 - **Resumo ⏱ no log do worker** (todo job): por loja e no total — chamadas ao ERP por etapa, tempo no ERP, média por chamada e tempo total.
 - **Teste de 1 filial:** `npx tsx scripts/seed-store.ts COD_FILIAL` (SEED fora da fila, **não grava** — só mede); `--gravar` persiste. Não rodar com `--gravar` em loja que já tem dados do mês anterior com DetMov (o enxuto zera as contagens WPINK daquele mês).
 - **Meses mais antigos** → **importação por planilha** (fase futura, zero chamada ao ERP).
 - **Dias fechados** → **fechamento noturno** (#23b).

23b. ✅ **Fechamento noturno de ontem (CLOSE)** (2026-09-24) — o dia fica completo mesmo que o último Atualizar tenha sido à tarde.
 - Job `CLOSE` (migration `20260924220000_sync_job_close`), 1× por integração por dia, enfileirado só na **janela da madrugada**: `CLOSE_HOUR` (default 3h) até +6h, no fuso da 1ª loja. Fora da janela não roda (evita carga no horário comercial); a noite seguinte recupera. `CLOSE_HOUR=off` desliga.
 - Janela = **ontem**; + **anteontem** se o CLOSE da noite anterior não terminou com sucesso (worker parado / falha). Nunca mais que 2 dias. 1ª noite da integração = só ontem. **Desde #35:** só lojas com dia pendente; loja com `last_closed_day` vai desde o dia seguinte a ele (chão = dia 1 do mês anterior).
 - Roda o **mesmo fluxo do Atualizar** (Lista, horas, formas, equipe, marca/CMV via margem, DetMov WPINK, categorias, top produtos) dia a dia, por fuso, com o relógio em 23:59:30 do dia (igual `force-day.ts`).
 - Não mexe no "Atualizado às…" (`last_light_sync_at`) nem gira o botão Atualizar. Prioridade na fila depois de FORCE/SEED. Pula com onboarding aberto, integração pausada ou SEED pendente.
 - Falha → job FAILED + Logs ("Fechamento do dia"); a noite seguinte cobre o dia perdido.

23c. ✅ **Carga do mês por trás (pós-onboarding)** (2026-09-24) — o onboarding não segura o usuário: **sem tela de carregamento**. Desde 2026-09-28 a etapa Integração ERP **não espera** nem o Atualizar de hoje: conecta e abre a Visão Geral em **Hoje** (`?periodo=hoje`) zerada, com o aviso "Buscando as vendas de hoje" até o SEED terminar; falha = "Tentar novamente" no próprio aviso (ver #12).
 - Ordem: grava `onboarding_step = null` no banco **antes** de enfileirar o SEED (o worker cancela jobs com onboarding aberto). `/sincronizando` ficou só para a troca de usuário ERP sem lojas em comum.
 - SEED ok → enfileira `CLOSE` com payload `{ from: ontem, to: ontem, fillUntil: dia 1 do mês }`. **1 dia por job**, do mais recente para o dia 1: terminou (ou falhou sem ser senha) → enfileira o dia anterior; chegou no dia 1 → para. Senha inválida interrompe a cadeia. Sem migration (reusa `CLOSE`; `claimNextJob` repassa `fillUntil`).
 - Fila: CLOSE tem prioridade abaixo de FORCE/SEED → o **Atualizar passa na frente** entre um dia e outro. Continua com o navegador fechado. Não mexe no "Atualizado às…". Dia que falha fica em Logs ("fechamento do dia"); o noturno cobre ontem se preciso.
 - **Período** (2026-09-25): todo dia **anterior a hoje** da carga roda no modo período (#33), em blocos de **mês calendário** — mês atual = 1 job do dia 1 até ontem; cada mês anterior = 1 job do mês. Lista + cupom + margem 1× por loja no bloco. Atualizar, automático e fechamento noturno seguem dia a dia. Barra de progresso: a cada dia gravado o worker salva `payload.progressDay` no job; a tela (`fetchMonthFill`) conta como carregado tudo desde esse dia (sem ele, usa o `to` do job).
 - **Períodos do `.env` do worker (2026-09-28; substitui `SYNC_HISTORY` e `DEEP_HISTORY=1` de 2026-09-25):** mesma escrita em `SYNC_ONBOARDING` e `DEEP_HISTORY` (`syncConfig.ts`) — `off` desligado · `Nd` N dias **contando hoje** (`1d` só hoje, `2d` hoje e ontem) · `Nm` N meses **contando o atual** (`1m` mês atual, `2m` mês atual + anterior). **Sem teto no código** (quem define é o `.env`). Valor inválido **impede o worker de iniciar** (sem cair em padrão escondido). `SYNC_ONBOARDING` = o que entra depois do onboarding (padrão `1m`); `DEEP_HISTORY` = histórico antigo na madrugada (padrão `off`, só `Nm`, ex.: `24m`). **`SYNC_ONBOARDING=off` (para testar o onboarding sem puxar dados):** o SEED **não busca nada de vendas** (Lista, margem/CMV, cupom, formas etc.), mas traz **todo o cadastro** do Millennium (`syncOnboardingRegistry`; 2026-09-28 — antes terminava sem ir ao ERP e a equipe ficava vazia): gerador de cada loja (se faltar) · **equipe (colaboradores) de cada loja** (`FUNCIONARIOS.Lista`/`Consulta`) · **produtos** (tipos + catálogo + tabelas de custo e preços — só se estiverem vazios, igual ao 1º onboarding da rede). As lojas já vêm gravadas pela etapa ERP. Termina `SUCCEEDED` com anotação em `sync_job.error` (o board abre zerado sem aviso e o sino ignora; falha de uma parte = só aviso no terminal). Detecção automática da tabela de custo da loja depende da margem (venda) → fica para o 1º Atualizar ou troca manual. Sem carga do histórico. **Cada chave cuida de uma coisa só (2026-09-29; antes o `off` também desligava o automático, a madrugada e o histórico antigo):** `SYNC_ONBOARDING` = só a carga do onboarding · `AUTO_REFRESH` (`on`/`off`, padrão `on`) = atualização automática de 30 min · `CLOSE_HOUR` (0–23 ou `off`, inválido impede o worker de iniciar) = fechamento da madrugada · `DEEP_HISTORY` = histórico antigo. **Recuperação de dias perdidos não depende de chave**: qualquer Atualizar (manual ou automático) ou fechamento da madrugada busca os dias depois do `last_closed_day` da loja. Onboarding sem carga do histórico (`off` ou `1d`) grava **ontem como último dia fechado** das lojas sem base (`setRecoveryBase`) — nada antes do onboarding é buscado, mas dia perdido depois disso é recuperado (antes a loja ficava sem base e o dia se perdia). Carga = 1 dia por job, de ontem até o dia mais antigo. A barra de progresso da tela lê o limite do job (`fillUntil`); texto "Carregando o histórico de vendas · 45%" (só %, sem "X de Y dias" — a busca no ERP é por período; 2026-09-25).
 - **Histórico antigo na madrugada (2026-09-25, `deepHistory.ts` + `enqueueDueDeepHistoryJobs`) — ⏸ DESLIGADO** (`.env DEEP_HISTORY`, padrão off) até terminarmos todos os cards/KPIs (evita recarregar 24 meses se o que gravamos mudar). Ligar: `DEEP_HISTORY=24m` (ou outro `Nm`). Depois da carga acima, volta **mês a mês até a inauguração da loja** (`store.opened_at` = `DATA_INAUGURACAO` do ERP; teto = `DEEP_HISTORY`, contando o mês atual; loja sem inauguração para após **3 meses seguidos zerados**). Só na **madrugada, 0h–6h no fuso de todas as lojas** (2026-09-29; antes pelo horário de funcionamento), **1 mês a cada 15 min** (3 chamadas por loja no mês, modo período), sem outro job na fila da credencial. Job = `CLOSE` com `payload.deep` (não encadeia; o agendador escolhe o próximo mês pelo dia mais antigo gravado de cada loja). Mês que falhou só volta na próxima madrugada (12h). Atualizar passa na frente. **Barra na tela (2026-10-07):** `DeepHistoryNotice` + `fetchDeepHistoryFill` / `useDeepHistoryFill` — mesmo padrão do `MonthFillNotice` (anel + %), título "Recuperando vendas antigas · X%"; copy explica madrugada 0h–6h e 1 mês / 15 min. % = meses já cobertos / horizonte (inauguração ou teto UI `DEEP_HISTORY_UI_CAP_MONTHS=24`). Aparece assim que há cobertura e ainda falta horizonte (**pode ser 0% de dia**, antes da 1ª madrugada — decisão do dono: acompanhar o % de manhã); esconde durante a carga do mês (MonthFill tem prioridade) e some ao terminar (`deepDone` ou progresso completo). Premissa: deep ligado em produção (`DEEP_HISTORY=24m`); com `off` a barra poderia aparecer sem a carga andar. `fetchMonthFill` continua ignorando `deep`. Ao terminar grava 1 marcador `payload.deepDone` → sino: "Histórico de vendas completo · desde MM/AAAA". O fechamento noturno ignora jobs de carga na checagem da noite anterior.
 - **`.env` do worker enxuto (2026-09-25):** só obrigatórios + `SYNC_ONBOARDING` + `AUTO_REFRESH` + `CLOSE_HOUR` + `DEEP_HISTORY` (+ `SYNC_LOG_VERBOSE` opcional). Ajustes finos (`POLL_INTERVAL_MS`, `MILLENNIUM_FETCH_TIMEOUT_MS`, `DET_MOV_CONCURRENCY`, `STORE_CONCURRENCY`) têm padrão no código e saíram do `.env.example`. `.env`/`.env.example` só em ASCII.
 - **Sem nada no header** (2026-09-24, pílula removida a pedido do dono).
 - **Telas (Visão Geral, Financeiro):** alerta na cor primary do tema, logo abaixo dos filtros (antes dos KPIs), com `RadialProgress` (% de dias carregados) + "Carregando histórico de vendas · 45%" enquanto a carga roda; some sozinho ao terminar (`MonthFillNotice`). Se o período da tela inclui dias ainda não carregados, o texto avisa que os totais estão parciais. Calendário libera desde o dia 1 enquanto a carga roda (`pickerMinDate`).
 - `useMonthFill`: 1 poll compartilhado (10s com carga ativa, 60s sem); cada dia que termina dispara `SALES_SYNCED_EVENT` → telas recarregam sozinhas.
 - 🔲 Erro na carga (dia que falhou / senha inválida) → alerta de erro com "Tentar novamente" (precisa de ação nova na Edge `erp-sync-enqueue`).

24b. ✅ **Configurações > Lojas em cards** (2026-09-24) — padrão Teams do Vela: 1 card por loja, **enxuto**: ícone + fantasia + CNPJ · avatares das vendedoras que venderam nos últimos 30 dias (`sales_seller_day_agg`) + "N vendedoras". Sem Metas/Horário/Custos pendentes no card por enquanto (`storeCostsPending` fica pronto em `stores.ts` para quando voltar).
 - **Loja desativada** (2026-10-05): interruptor **Em operação** no card (Gestor e Gerente). Desligada, badge **Desativada** e a loja some do seletor, das análises, dos Primeiros passos, das configurações da operação e da sincronização — para o dia a dia ela não existe. Continua só nesta lista, com o cadastro e o vínculo do Millennium guardados (`store.active`; reconectar o ERP não religa). Ao ativar, volta ao seletor com o que já estava sincronizado.
 - Clique abre **página de detalhe** `/settings/stores/:id` (padrão UserDetails do Vela: Voltar + breadcrumbs; coluna única `max-w-[720px]`: Funcionamento · Custos da operação · Vendedoras (últimos 30 dias; vira lista sincronizada quando o sync de funcionários entrar). **Salvar por card** (2026-09-24, substitui o auto-save): Funcionamento e Custos da operação têm cada um **Resetar** (outline) + **Salvar alterações** (primary) no rodapé, padrão Horizontal layout de `FormLayoutsPage`. Botões desabilitados sem alteração; Resetar volta ao último salvo; Enter num campo salva o card; sucesso = toast "Alterações salvas.", erro/validação = toast danger. Só OWNER/MANAGER/ADMIN_GLOBAL veem os botões.
 - **Custos por loja** (migration `20260924150000_store_costs`): royalties %, marketing %, aluguel % por marca (WEPINK/WPINK) + aluguel fixo R$/mês (`rent_fixed_cents`). null = não configurado.
 - **Card Custos da operação = só custos em %** (2026-09-24): campos com a marca no rótulo — Royalties WEPINK · Taxa de marketing WEPINK · (Royalties WPINK · Taxa de marketing WPINK só se a loja tem WPINK) · **Aluguel percentual** (1 campo, sobre o faturamento total → grava igual em `rent_wepink_pct` e `rent_wpink_pct`). Custos fixos (aluguel fixo etc.) saem daqui — tela própria depois; `rent_fixed_cents` é preservado no save.
 - ~~**Card Configuração da operação**~~ **substituído no mesmo dia pelo menu próprio (#43)** (2026-09-28; substituía os cards Custos da operação e Custo dos produtos): subtítulo "Parâmetros utilizados pelo WDash para calcular custos, margens e resultados da operação." Grupos: **Franquia** (Royalties · Taxa de marketing — com a marca no rótulo só quando a loja tem WPINK) · **Aluguel** (Aluguel percentual) · **Produtos e impostos** (Tabela de custo dos produtos · ICMS · ICMS ST). **Um Resetar/Salvar para o card todo**: tabela trocada busca os preços no ERP antes; falhou → nada é gravado. Só Gestor.
 - ✅ Custos fixos / variáveis / outras despesas e Aluguel mínimo entraram nas telas de Configurações da operação (#43). **Detalhe da loja = só Funcionamento.**
 - **Impostos** (2026-09-24, migration `20260924210000_store_taxes`): no mesmo card e na mesma grade, sem divisória nem card próprio (ordem: royalties/marketing → ICMS · ICMS ST → Aluguel percentual) — **ICMS** (% sobre o faturamento, `icms_pct`) e **ICMS ST** (% sobre o CMV, `icms_st_pct`). Um % por loja (vale para WEPINK e WPINK). Entram **antes** do Lucro bruto (ver #30). Vazio = 0 (não usa padrão).
 - **Impostos por marca** (2026-10-07, decisão do dono): ICMS e ICMS ST deixam de ser um percentual só da loja. Configurações > Produtos e impostos tem uma parte **WEPINK** e, se a loja vende WPINK, uma parte **WPINK** (`icms_wepink_pct`, `icms_wpink_pct`, `icms_st_wepink_pct`, `icms_st_wpink_pct`). ICMS incide sobre o faturamento daquela marca; ICMS ST sobre o CMV dela. Loja sem WPINK só preenche WEPINK. O percentual antigo foi copiado para as duas marcas para o lucro bruto não mudar até o gestor ajustar a WPINK. Primeiros passos exige os quatro campos quando a loja vende WPINK (0 conta; vazio não).
 - Financeiro > Custos da operação usa os custos da loja; **campo vazio = 0** (2026-09-26 — antes caía num padrão 5% / 5% / 2% e inventava custo). Sem nada configurado → Total de custos R$ 0 e Resultado = Lucro bruto. Rótulo mostra o % só quando todas as lojas do escopo usam o mesmo.
24. ✅ **Configurações > Lojas — fuso + horário** (2026-09-23) — tela simples em `/configuracoes/lojas`.
 - Por loja: **timezone IANA** (lista BR) + **horário por dia** (0=dom…6=sáb), estilo Google Meu Negócio (1 linha por dia: switch Aberto/Fechado + abertura – fechamento + "Copiar para todos" no 1º dia aberto).
 - Coluna `store.hours` (jsonb) + UPDATE RLS p/ OWNER/MANAGER; `store.timezone` já existia.
 - Eixos de hora (Visão Geral e fixtures) usam `unionOpenWindow(horas, dow)` — não mais abertura/fechamento fixos.
 - UI refinável depois; sync já usava `timezone` no worker.
 - ~~**Sincronização não usa horário**~~ (2026-09-29; **revertido em 2026-09-30**, ver #35 "Expediente de volta"): atualização automática volta a seguir o horário da loja.
 - **Configurações > Loja** (2026-09-30, decisão do dono; volta o Funcionamento ao menu): 1ª aba de Configurações (Loja · Franquia · Aluguel · Produtos e impostos), rota `/operation/store` (`StorePage`), Gestor e Gerente. 1 card por loja do StorePicker com **Funcionamento** (fuso + horário por dia, Resetar/Salvar do card) — formulário único `StoreScheduleForm` (`src/pages/operation/StoreSchedule.tsx`), reusado no detalhe da loja (Administração > Lojas). Serve para posicionar as vendas por hora e distribuir a meta do dia (Faturamento x meta). Loja 00386 ainda sem horário.
 - **Eixo por hora igual em todos os gráficos** (2026-09-30, `hourAxisRange` em `storeHours.ts`): Faturamento x meta (Visão geral) e CMV, lucro e margem / Resultado operacional (Financeiro em 1 dia) = **expediente configurado das lojas no dia** (ex.: 10:00–22:00 → 10h a 21h, rótulo = início da hora); venda fora do expediente estende o eixo; meta de hora fora do expediente vai para as pontas (não estende). Nenhuma loja com horário → horas com venda ∪ horas com meta; sem nada, 10h–22h. **Hoje = dia inteiro** nos dois: as horas que ainda não chegaram ficam sem linha (Financeiro antes parava na hora atual). Tooltip mostra a faixa completa ("21h às 22h"; hora em andamento "14h até agora" — `faixaHora`, prop `tooltipLabels` do `AreaLineChart`), porque o eixo termina em "21h" com a loja fechando às 22:00.
 - **Padrão no banco = todos os dias desligados** (2026-09-26, migration `20260926190000_store_hours_default_off`; antes seg–sáb 09–21). Nenhum dia aberto = **horário não configurado**. **Preenchimento sugerido no formulário** (2026-10-07): conforme `pointType` — shopping/quiosque seg–sáb 10h–22h e domingo 12h–22h; loja de rua seg–sex 8h–18h, sábado 8h–17h, domingo fechado (`presetWeekHours`). O gestor ajusta e salva; botão "Preencher com o padrão…". Gráficos por hora: **eixo sai das vendas** se sem horário; `unionConfiguredWindow` ignora loja sem horário. Curva da meta por hora = horas que venderam no histórico; sem histórico, 10h–22h só para distribuir a meta. Pesos por dia da semana sem histórico = todos os dias (`effectiveWeekHours`).

25. ✅ **Faturamento x meta — só por período** (2026-09-24) — Visão Geral.
 - **Sem toggle Acumulado** (removido 2026-09-24): "vou bater a meta?" já é respondido pelo card **Atingimento da meta** ao lado (faltam + projeção).
 - Gráfico de linhas com o valor de **cada hora / dia / mês** × meta daquele ponto — a linha sobe e desce; responde "qual hora/dia foi fraco?".
 - `view.evolucao` continua **acumulada** (header Realizado/Meta = último ponto); a página faz a diferença ponto a ponto.
 - **Eixo hora (1 dia)**: cada ponto rotulado pelo **início** da faixa, na hora local da loja (`10h` = 10:00–10:59; `21h` = 21:00–21:59) — 2026-09-30; antes era pelo fim ("11h" = 10:00–10:59), herança do gráfico acumulado, e confundia o gestor. Internamente há um ponto-âncora R$ 0 na abertura (`ancora: true`) que a página descarta. Venda antes da abertura / após o fechamento estende o eixo. Hoje: último ponto = `Agora`.
 - **Dia inteiro no eixo** (2026-09-30, pedido do dono — de manhã o gráfico ficava com 1 ponto só e vazio): eixo = expediente configurado ∪ horas com meta (curva do histórico; sem histórico 10h–22h) ∪ horas com venda. Hoje, as horas que ainda não chegaram mostram **só a linha da meta** (`EvolutionPoint.futuro`); a linha do realizado para em "Agora" (`AreaLineChart` aceita `null` em `data`). Cabeçalho "Meta" do card = meta do dia inteiro.
 - **Curva da meta** (`src/data/wedash/goalCurve.ts`), por loja:
   - **Dia** = meta do mês × peso do dia da semana ÷ Σ pesos dos dias do mês. Peso = média do faturamento daquele dia da semana nas **6 semanas antes do período** (`goalHistoryDayRange`). Sem histórico: dia aberto (Configurações > Lojas) = 1, fechado = 0.
   - **Hora** = meta do dia × participação histórica da hora no expediente, usando o **mesmo dia da semana das 6 semanas anteriores** (`goalHistorySameWeekdays`). Sem histórico: divisão igual pelas horas do expediente.
   - Meta de loja sem venda cujo expediente sai do eixo é somada nas pontas (total do dia preservado).
 - Metas ainda são fixture (`goals.ts`, lojas f1/f2) → lojas reais mostram meta 0 até o CRUD de Metas.
 - Pendente: linha de projeção.

25b. ✅ **Badges de comparativo na Visão Geral real** (2026-09-24) — antes só a versão fixture tinha delta. Agora `prevDayAggs`/`prevHourAggs` (período anterior de `previousPeriod`) alimentam Faturamento · CMV · Nº de vendas · Ticket médio + `deltaFaturamento` dos cards. Mesma regra do Financeiro: **hoje** = mesmo dia da semana passada **até a hora atual** (precisa de `sales_hour_agg` daquele dia; sem horas → sem badge, nunca compara dia parcial com dia cheio). CMV só com CMV nos dois lados. Sem venda no período anterior → sem badge. **Sem venda no período atual → sem badge** (ex.: hoje antes do Atualizar; não mostra −100%) — vale para KPIs, cards (`deltaFaturamento`) e faixas WPINK da Visão Geral e do Financeiro.
 - **Comparativo alinhado pelo horário** (2026-09-24): todo período que **termina hoje** (Hoje, Esta semana, 7 dias, Este mês, personalizado até hoje) compara com o período anterior equivalente, com o **último dia do anterior só até a hora atual** (`sales_hour_agg`); os demais dias inteiros. Ex.: Este mês às 16h = 01–24/09 × 01–23/08 inteiros + 24/08 até 16h. Loja que vendeu no dia equivalente sem horas gravadas → sem badge. **Esta semana** compara com os mesmos dias da semana passada (seg→qui × seg→qui), rótulo "a semana passada". `previousPeriod(periodo, horaAtual)` devolve `horaMax` (vale para `fim`); `ResolvedPeriod.terminaHoje`.
 - **CMV / Lucro / Margem / Resultado** (sem CMV por hora): período terminando hoje compara **sem o dia de hoje nos dois lados** (tooltip "Em relação à semana passada, até o mesmo dia: R$ …"; 1 dia = "à segunda-feira passada" / "ao sábado passado"). Em "Hoje" isso fica vazio → sem badge (como antes). Vale para KPIs e faixas WPINK da Visão Geral e do Financeiro.
 - **Tooltip do badge mostra o valor comparado** (2026-09-24): "Em relação ao mês passado: R$ 12.345,67." (`kpiDelta`/`kpiDeltaPp` devolvem `anterior`; texto em `tipDelta`). R$ com centavos para valores em dinheiro; contagens/P.A. como número; margem como `xx,x%`. Vale para todas as telas (StatCard e `BadgeVsAnterior`).
 - Faixa **WPINK** também tem badge (ao lado do valor): compara com as linhas WPINK do período anterior; hoje = **horas WPINK** do mesmo dia da semana passada até a hora atual (sem horas WPINK → sem badge).
 - **"Hoje" não tem badge de CMV / Lucro / Margem / Resultado** (Visão Geral, Financeiro e faixas WPINK): não existe CMV por hora, e ratear o CMV do dia anterior seria estimativa.
 - **Nada é estimado** (decisão do dono, 2026-09-24): linha WPINK antiga só com receita (sem DetMov: vendas/itens/CMV = 0) → CMV / Nº de vendas / Ticket WPINK mostram "—" e **sem badge** se algum dia com venda WPINK do período (atual ou anterior) não tem o dado (`wpinkRows`). Faturamento WPINK segue normal. Quando a carga do passado completar esses dias, valores e badges aparecem sozinhos.
 - Dado real (2026-09-24): `sales_hour_agg` só tem 22–23/09 e agosto não tem CMV → "Hoje" sem badge e CMV/Lucro/Margem de "Este mês" sem badge até backfill (`force-day.ts` / job noturno #23).

26. ✅ **Ranking de lojas com 1 loja no StorePicker** (2026-09-24) — donut = fatia da loja × **"Demais lojas (N)"** (cinza neutro, resto da rede); centro = `% da rede` da loja. Lista abaixo: card da loja + card Demais lojas (R$ + %). Com "Todas" segue o donut por loja com o total no centro.

27. ✅ **Configurações > Integrações (card Vela)** (2026-09-24) — grid de cards estilo aba Integrations do Vela; card **Millennium** (logo Linx `public/linx.png`, status Conectado / Pausado / Senha inválida / Não conectado).
 - **Copy revisada (2026-10-01, spec do dono):** subtítulo "Gerencie as conexões da WDash com seus sistemas." (não preso ao Millennium) · card "ERP Linx · vendas, custos, lojas e equipe" · status **Não configurado** (nunca conectou; antes "Não conectado") × **Desconectado** (Gestor desconectou) · conectado = botões **Gerenciar** (antes Configurar) + **Atualizar cadastros** (tooltip "Atualiza lojas e tabelas de custo do Millennium. Não busca vendas."). Modal conectado = "A WDash está conectada ao Millennium com o usuário X. As sincronizações acontecem automaticamente…" + campos só leitura + blocos **Alterar usuário ou senha** (desconectar e conectar de novo) e **Desconexão** (para de sincronizar e encerra a sessão no Millennium); **sem os checkboxes** quando conectado. Senha inválida = `Alert` danger "A senha do Millennium não é mais válida." / "Conecte novamente com a senha atual…". Checkbox "Este usuário será usado somente pela WDash" (explica a reconexão automática) e "Autorizo a WDash a usar este acesso…". Troca sem loja em comum com texto mais explícito. Sem permissão = "Você não tem permissão para alterar esta integração." (fallback). Onboarding segue com os textos próprios.
 - **Aviso de integração desligada nas telas** (2026-10-01, decisão do dono): `ErpStatusNotice` (`src/pages/dashboard/ErpStatusNotice.tsx`), `Alert` **amarelo**, fixo enquanto durar, logo abaixo dos filtros e antes dos demais avisos na Visão geral, Financeiro, Produtos e Equipe, e nos avisos do cabeçalho do Estoque. Desconectado (`sync_paused` ou status ≠ VALID) = "Millennium desconectado"; senha recusada (INVALID) = "A senha do Millennium não é mais válida". Texto: "As vendas não estão sendo atualizadas desde DD/MM às HH:MM (ou hoje às HH:MM). Os números mostram as vendas até esse momento." (sem busca anterior: só a 1ª frase; Estoque: "O estoque não está sendo atualizado. Os valores mostram a última atualização disponível."). **Gestor** = link "Conectar" / "Atualizar senha" → Integrações; **Gerente também vê**, sem link, + "Peça ao gestor da conta para conectar novamente." (senha inválida: "Peça ao gestor da conta para atualizar a integração.") Status relido ao abrir a tela, ao voltar para o app e ao terminar uma sincronização (`useErpConnection`, 1 leitura a cada 5s por empresa). Com a integração desligada: aviso de loja sem horário some (nada atualiza mesmo); botão Atualizar = tooltip "Millennium desconectado" / "A senha do Millennium não é mais válida", sem bolinha amarela, clique = toast "O Millennium está desconectado. As vendas só podem ser atualizadas depois que a integração for conectada novamente." (não enfileira). Sino continua com o problema fixo para o Gestor. Não cobre o sincronizador da WDash parado com a integração ligada (problema de operação, não do cliente). `PageHeader` esconde a área de avisos vazia (`empty:hidden`).
 - **Modal simples** (2026-09-24): só credenciais + os 2 checks do onboarding (usuário exclusivo · autorizo). Sem painel de status/erros (isso fica em Logs).
 - **Conectado** → campos só leitura + **Desconectar** (`Button` danger; pause + release). **Não conectado / Desconectado / Senha inválida** → formulário editável + **Conectar** (exige "Autorizo"). Card mostra "Desconectado" após desconectar (não "Pausado").
 - Trocar senha/usuário = Desconectar → Conectar com as novas credenciais (persist já zera `sync_paused`).
 - **Troca de usuário compara lojas** (2026-09-24) — vendas são fatos do ERP, não do usuário; só apaga o que o usuário novo não enxerga. Fluxo em 2 passos (`prepareErpCredentialChange` testa login+relatórios e calcula o plano → `applyErpCredentialChange` grava):
 - **Mesmas lojas** (ou mais) → troca silenciosa, sem aviso, dados/fuso/horário/vínculos intactos.
 - **Algumas somem** → aviso lista só essas lojas + checkbox; remove só elas (agregados em cascata). Demais intactas, sem SEED.
 - **Nenhuma em comum** → aviso + checkbox; apaga tudo, recria lojas, SEED + `/sincronizando` (comportamento antigo).
 - Cancelar/editar campos após o teste → desloga a sessão aberta no teste. Edge `erp-credential-persist` aceita `userChange: { mode: "keep", removeMillenniumStoreIds }`; sem isso mantém o wipe antigo (onboarding).
 - `changeErpCredential` (erp.ts): testa login → persiste com o token novo → se trocou usuário, enfileira SEED. Edge `erp-credential-persist` não desloga mais o token novo ao limpar o tenant.

28. ✅ **Configurações > Logs** (2026-09-24) — `/settings/logs`, tabela `sync_log` (ERROR | WARN), RLS leitura OWNER/MANAGER/ADMIN_GLOBAL, **retenção 120 dias** (worker limpa no boot e a cada 6h).
 - Worker: buffer por job (`syncLog.ts`) gravado no fim do job (best-effort). Mensagens **sanitizadas** (sem WTS-Session, senha, Bearer, query string). Repetição (mesma origem + loja + mensagem) agrega em `detail.count` / `detail.days`; teto 200 linhas/job.
 - **ERROR:** login recusado/falho, job interrompido, `VENDAS.Lista` desistida após retry. **WARN (soft-fail):** marca/CMV (margem), CMV, categorias `{2C46ADF5}`, top produtos `{E7A5C5C7}`, detalhe do movimento, mapa de produtos / LISTARVENDASSALDO, loja sem gerador, Millennium ocupado (reduziu paralelismo).
 - **Indícios p/ debug:** todo log grava `detail.worker` (`version` = commit curto, `+local` se rodando com alterações não commitadas; `WORKER_VERSION` sobrescreve · `startedAt`). ERROR grava `detail.stack` (8 frames, caminho relativo ao worker, sanitizado). Detalhe (2026-09-28, copy revisada) = Quando · Nível · Origem (só o rótulo) · Tipo de sincronização · Loja · Período · Ocorrências · Mensagem; o técnico fica recolhido em **"Informações técnicas"** (identificadores da sincronização e da tarefa, usuário do Millennium, versão da sincronização, detalhes técnicos do erro) — nunca "job", "worker" ou "rastro do código" no primeiro nível; **Copiar detalhes** gera bloco pronto para colar no chat. Todo log também grava `detail.erpUser` (usuário Millennium usado no job; 2026-09-25) → aparece como "Usuário ERP" no detalhe e no Copiar detalhes.
 - **Fora dos logs:** jobs RANGE descartados ("sync manual"). A Visão Geral **não enfileira mais RANGE** (2026-09-25; `requestRangeSync` removido) — dias faltando vêm da carga do histórico / fechamento noturno.
 - Tela no padrão Activity Logs do Vela: `Timeline` em `Card`; cada item = frase curta (`syncLogSummary`) + "há X · loja". **Igual ao `ActivityLogs.tsx` do Vela** (2026-10-01): "caixa de entrada de problemas" (decisão do dono 2026-10-01: a pergunta é "o que deu errado?") — 1ª linha = **o problema em negrito** (`syncLogSummary`) + Badge Erro (danger) / Aviso (warning); 2ª linha (contexto) = "tipo de sincronização · há X (ou 30 de set., 07:19 depois de 24 h) · loja · N ocorrências" (tipo sem job = "Sincronização"; loja só quando o log é de uma loja; ocorrências só > 1). Mensagem técnica só no detalhe; símbolo de **uma cor só, na cor do tipo e sem fundo** (sem hover de link no título) (como no Vela: ⚙ 🗑 ✉ aparecem na cor do círculo; emoji colorido tipo 🧾💰 não combina) — `SOURCE_STYLE`: 🔑 acesso · ⟳ sincronização interrompida · 🗎 vendas · 🗠 marca/CMV · 🛍 produtos por venda/detalhe · 🗄 produtos/categorias · ⚙ gerador · 🗓 eventos · 🗣 equipe · ⏱ Millennium lento · ✖/⚠ demais erros/avisos. `\uFE0E` força o símbolo de texto (sem ele o navegador desenha o emoji colorido). A mensagem técnica saiu da lista (fica no detalhe; a busca ainda procura nela). Filtros à direita empilhados (medida igual à do Activity Logs do Vela: coluna de 288px no desktop, largura total no celular, campos de 42px): busca · Todos os eventos/Erros/Avisos (sem filtro de data por enquanto; lista os 500 mais recentes da retenção). Clique abre detalhe (origem, dias afetados, ocorrências, mensagem técnica).
 - **Textos dos Logs refinados** (2026-10-01, spec do dono): regra = **problema curto na lista → explicação simples no detalhe → texto bruto do Millennium só em Informações técnicas**. `SYNC_LOG_TEXT` (`syncLogs.ts`) dá por origem o problema (`syncLogSummary`: "Top produtos não carregados", "CMV por produto não calculado"…) e a explicação (`syncLogExplanation`). Casos derivados da mensagem: acesso = "Senha do Millennium inválida" (senha recusada) ou "Não foi possível acessar o Millennium"; equipe = "Colaborador não identificado no Millennium" ou "Colaborador com cadastro duplicado no Millennium" (com o NOME da pessoa na explicação). Detalhe: problema + badge no topo · Quando · Nível · Origem · Tipo de sincronização (sem job = "Sincronização") · Loja · **Período afetado** ("29/09/2026" ou "29/09/2026 a 30/09/2026"; dias com buraco = lista) · Ocorrências · **Mensagem = explicação amigável**; "Detalhes técnicos do erro" (dentro de Informações técnicas) = mensagem bruta + stack. Busca procura também na explicação; "Copiar detalhes" inclui a explicação. Vazio = ✅ "Tudo certo" / "Nenhum erro ou aviso na sincronização." (emoji, não ícone — decisão do dono).

29. ✅ **Vendedoras vindas do ERP** (2026-09-24) — lista de vendedoras da loja deixa de ser "quem vendeu nos últimos 30 dias" e passa a ser **sincronizada do Millennium**. Tabela `store_seller` (migration `20260924180000_store_seller`).
 - **API:** `millenium.FUNCIONARIOS.Lista?$top=500` body `{ ORDEM:1, CAMPO:1, FILTRO:2, …, FILIAL, CARGO:null }` — **sem filtro de cargo** (2026-09-24): ao desativar, o ERP troca o cargo **VENDEDOR → INDEFINIDO**, então `CARGO:1` só devolvia as ativas. A Lista **não traz status** → 1× `FUNCIONARIOS.Consulta { FUNCIONARIO }` por funcionária (concorrência 5; filial 8 = 31 funcionárias).
 - **Quem entra na equipe:** **ativa só com cargo VENDEDOR** (dono sem cargo, gerência e conta genérica da loja ficam gravados com `erp_role`, mas fora da equipe e do ranking — ver #36) · **inativa de qualquer cargo** (ex-vendedoras; histórico do Top vendedoras depende delas). Filial 8: 6 ativas + 23 inativas. **Inativa** = OR de `GERADORES[0].DESATIVADO` · `INATIVO` · `AFASTADO` · `NAO_MOSTRAR_NO_EVENTO`. Sumiu da Lista → `in_erp=false` (linha fica).
 - **Venda ↔ vendedora pelo código do ERP** (migration `20260924200000_seller_employee_link`): `VENDAS.Lista` só traz o nome (`VENDEDOR_MILLENNIUM`, sem código). O worker resolve **nome → `FUNCIONARIO` na gravação** e grava `sales_seller_day_agg.seller_employee_id`; trocar o nome no ERP não afeta o passado. `store_seller.name_keys` = todos os nomes normalizados já vistos da funcionária (nome antigo continua resolvendo). Busca prefere a loja da venda, senão qualquer loja do tenant (cobrindo folga). Top vendedoras agrupa pelo código (nome exibido = do dia mais recente); sem código agrupa pelo nome.
 - **Quando sincroniza (worker, `sellerLinker.ts`):** em qualquer job com Lista (SEED/FORCE/LIGHT/HISTORY/RANGE), por loja, no máx. 1× por job, **antes** de gravar o ranking — **só** se aparece gerador/nome sem cadastro (2026-09-25: saiu o gatilho de 24h; status Ativo/Inativo = botão Atualizar do card da equipe). Nessa sincronização, quem já tem gerador salvo não é consultado (`skipConsulta`). Nome que segue sem cadastro (gerente, outro cargo) → fica só pelo nome, WARN em Logs 1×, não re-dispara por 24h. Homônimas na mesma loja → só pelo nome + WARN. Falha do ERP → soft-fail (WARN); 401 derruba o job.
 - Após cada sync de vendedoras (worker e Edge do card), `link_seller_day_aggs(tenant, loja)` liga os dias antigos gravados só com nome.
 - **UI:** detalhe da loja = card **Equipe de vendas** (título + descrição no header) + `DataTable` (coluna **Nome** com Avatar · coluna **Código ERP** · coluna **Status** com Badge "Ativo"); vazio = "Ninguém na equipe" (centralizado, padrão Visão Geral). Card renomeado para **Equipe** com subtítulo fixo "Sincronizada do Millennium" (2026-09-26). **Pills Ativos (N) · Desligados (N)** (2026-09-26, substitui "só ativos"): `Segmented` abaixo do título, padrão = Ativos. Ativos = ativo com cargo VENDEDOR (com coluna **Turno**); Desligados = qualquer funcionário inativo no ERP (ex-vendedoras — o ERP troca o cargo para INDEFINIDO ao desativar), Badge neutro "Desligado", sem coluna Turno. Vazio = "Nenhum colaborador ativo" / "Nenhum colaborador desligado" (Gestão > Colaboradores fala em **colaboradores**, 2026-09-28: subtítulo "Colaboradores de cada loja, sincronizados com o Millennium.", erro do Atualizar "Não foi possível atualizar os colaboradores. Tente novamente."). **Atualizar** (Gestão > Colaboradores, 2026-09-28): loja sem ninguém sincronizado = botão primário abaixo da mensagem (padrão Turnos), sem botão no canto e sem as pills Ativos/Desligados; com pessoas = botão secundário no canto superior direito. Sem busca. Card da listagem de lojas conta/mostra só ativos ("N na equipe").
 - **Copy neutra em gênero** (2026-09-24) — há vendedores homens. UI nunca usa "vendedora(s)" / "Ativa" / "cada uma": usar **Equipe de vendas**, **Nome**, **Ativo/Inativo**, **pessoa(s) da equipe**, "N na equipe". Visão Geral: **Destaques da equipe** (ex-Top vendedoras); Ao vivo: **Ranking da equipe**; papel `SELLER` = "Equipe de vendas"; logs do worker: `Pessoa "…" não está no cadastro…`. Identificadores de código (`vendedoras`, `SellerRow`…) e comentários ficam como estão.
 - **Atualizar do card** (OWNER/MANAGER) = só as vendedoras daquela loja, **síncrono** via Edge `erp-sellers-sync` (não passa pela fila do worker; funciona com worker parado). Reusa o token salvo em `erp_credential`; 401 → login com a senha cifrada e salva o token novo. Integração desconectada / senha inválida → toast pedindo reconectar em Integrações. Lógica ERP espelhada em `supabase/functions/_shared/millenniumSellers.ts` ↔ `workers/millennium-sync/src/millenniumSellers.ts` (manter iguais).
 - 🔲 **TODO (depois):** editar vendedora (WhatsApp, e-mail — só no nosso banco), botão **enviar acesso por e-mail** (entra no WDash com visão de vendedora) e **permissões** do que a vendedora pode ver. Fora do foco agora.

30. ✅ **Financeiro em dados reais** (2026-09-24) — `buildFinanceView(escopo, aggs)` → `buildFinanceViewFromAggs` quando há agregados (a versão fixture quebrava com lojas reais → tela preta).
 - Fonte: `sales_day_agg` (ALL/WEPINK/WPINK + `cmv_cents`), `sales_hour_agg` (1 dia), `sales_payment_day_agg` (formas = só total). `fetchSalesDayAggs` pagina de 1000 em 1000 (teto do PostgREST).
 - Loja sem split de marca → tudo WEPINK; contagens por marca rateadas do ALL quando vierem 0. Hora sem marca = hora ALL × participação da marca no dia.
 - Custos: % da loja (Configurações > Lojas), **vazio = 0** (sem padrão inventado). **Aluguel fixo real = `rent_fixed_cents` ou 0**; linha só aparece se > 0.
 - Comparativo: período anterior (1 dia hoje = mesmo dia da semana −7 até a hora atual). Sem CMV → KPI "—" e sem delta.
 - **Lucro bruto = Faturamento − CMV − ICMS − ICMS ST** (com "?" explicando; sub "Impostos R$ X" quando > 0). ICMS = % da marca × faturamento da marca; ICMS ST = % da marca × CMV da marca; sem configuração = 0. Loja sem split de marca usa o percentual WEPINK. Custos % da loja (royalties, marketing, aluguel) e aluguel fixo **não** entram — são descontados no **Resultado operacional**. Margem, gráfico Custo/Lucro, Resultado, Evolução mensal e faixa WPINK usam o mesmo lucro.
 - Evolução mensal (2026-09-26, `monthlyEvolutionMonths`) = **só em período mensal pelo calendário, nunca por contagem de dias** (fevereiro tem 28): Este mês · Mês passado · Este trimestre/semestre/ano · personalizado do dia 1 até o fim do mês (ou até hoje) · ou qualquer período > 31 dias. Hoje, Ontem, 7 dias, Esta semana e personalizado curto = card oculto.
 - **1 mês só** (Este mês, Mês passado, fevereiro inteiro…) → o mês + os **5 anteriores inteiros** para comparar; subtítulo "setembro de 2026 e meses anteriores". **Vários meses** → os meses do filtro; subtítulo = rótulo do período.
 - Mês parcial mostra o recorte no nome: "setembro · 01 a 26", "julho · 10 a 31". Só meses com faturamento. Ano no nome só se a lista atravessa anos. A busca do Financeiro/Produtos puxa os 5 meses extras só no caso de 1 mês.
 - Recarrega sozinho quando o Atualizar do Topbar termina (ver #31).
 - **Padrão Visão Geral** (2026-09-24): filtros = só Período + Exportar (**sem filtro de Marca**; view força `divisao: null` — marca aparece no card Faturamento por marca quando há WPINK). Valores sempre em `brlCent` (R$ completo com centavos; **sem `brlK`**) em KPIs, cards, gráficos e tabela. Sem vendas → cada card mostra o próprio vazio (`EmptyBlock`); o card geral "Ainda não há vendas…" foi removido das três telas (2026-09-26, redundante e desatualizado).
 - **Copy revisada (2026-10-01, spec do dono):** subtítulo "Acompanhe faturamento, custos, margens e resultado da operação." (nunca "receita" — o termo oficial é Faturamento) · dica do card CMV, lucro e margem = "Compare a evolução do CMV e do lucro bruto e acompanhe a margem do período." (margem é %, não uma parte do faturamento) · linhas do Custos da operação = **"Taxa de marketing WEPINK/WPINK (X%)"**, mesmo nome do campo em Configurações > Franquia · badge da Margem = "+1,2 p.p." com dica "Em relação ao mês passado: 58,3%." (valor anterior em %, nunca R$) · sem "?" em Faturamento, Formas de pagamento, Faturamento por marca e Evolução mensal ("?" só onde há regra ou conceito que merece explicação).
 - **Faixa WPINK** abaixo dos KPIs (única tela com separação por marca desde 2026-09-26), só se alguma loja do escopo tem WPINK: Faturamento WPINK (% do faturamento) · CMV WPINK · Lucro bruto WPINK · Margem WPINK, com badge vs período anterior. Mesma regra "nada estimado" do #25b (`buildFinanceWpinkKpis` / `wpinkTotals`).

31. ✅ **Atualizar global no Topbar** (2026-09-24) — o botão saiu do cabeçalho das telas e ocupa o lugar do antigo botão de tema, **em todas as telas** (o cabeçalho é o mesmo para todas).
 - Um botão só = FORCE de **hoje** da loja do StorePicker ("Todas" = rede); atualiza tudo o que vem do ERP (vendas, horas, formas, marca/CMV, categorias, top produtos, equipe). Não existe Atualizar por tela: dados compartilhados + um "Atualizado às…" só evitam números divergentes entre telas.
 - Dado futuro **exclusivo e pesado** de uma tela (ex.: estoque em Produtos) → o mesmo botão acrescenta essa parte quando a tela estiver aberta.
 - `src/layout/TopbarRefresh.tsx` (só o ícone, desktop e celular — **o horário saiu do botão em 2026-09-26** e foi para as telas: linha **"Vendas de hoje atualizadas às HH:MM"** (2026-09-29; antes "Última atualização às…"; hoje ainda sem busca = "Vendas de hoje ainda não atualizadas · última atualização em DD/MM às HH:MM"; tooltip explica que é a última busca das vendas de hoje e que o fechamento da madrugada / carga do histórico não mexe — decisão do dono: manter a regra `last_light_sync_at` e deixar o texto claro) **abaixo dos filtros e do Exportar** (à direita no desktop) na Visão geral, Financeiro, Produtos e Equipe. **2026-10-01 (decisão do dono): a linha saiu das telas e voltou para o botão Atualizar** — tooltip "Vendas de hoje atualizadas às HH:MM" (ou, em duas linhas, "Vendas de hoje ainda não atualizadas" + "Última atualização em DD/MM às HH:MM"; nunca atualizou = só "Vendas de hoje ainda não atualizadas", e no menu do celular o título fica "Vendas de hoje") + "Próxima atualização às HH:MM" na linha de baixo — **copy do Header revisada (2026-10-01, spec do dono):** busca "Buscar na WDash…" (resultado da paleta = nome + grupo na linha de baixo, "Principal" sem grupo) · textos do Atualizar sempre falam em **vendas** (aria "Atualizar as vendas de hoje da loja selecionada / de todas as lojas", "Buscando as vendas de hoje no Millennium…", erros "Não foi possível atualizar as vendas. Tente novamente em alguns minutos." / "Você não tem permissão para atualizar as vendas."; bolinha com texto acessível "As vendas de hoje precisam ser atualizadas") · avatar do dono = "Gestor principal" · alerta Millennium desconectado = "…Conecte novamente para retomar a sincronização." · dicas do menu: Estoque "Acompanhe o estoque e prepare os pedidos de compra.", Gestão "Gerencie metas, desafios, grupos e vendedores." · card do app (equipe de vendas) "Instale o app para receber avisos quando avançar para um novo nível de premiação."; **bolinha amarela no ícone** (funciona no celular, onde não há tooltip) quando as vendas de hoje ainda não foram buscadas ou a última busca tem mais de 1h (2 rodadas automáticas) com alguma loja do escopo aberta (`storePhase` = open; loja sem horário não conta). **Celular / tablet (sem hover, `(hover: none)`): o toque no botão abre um menu** com o horário da última busca (+ próxima atualização) e o item **Atualizar agora** — 1 toque a mais para atualizar, mas o gestor vê se o dado está fresco antes; atualizando = "Buscando as vendas de hoje…" + "Atualizando…" desabilitado. Computador continua clique = atualiza + tooltip. O PDF continua com a linha no cabeçalho (`LastUpdated` só no `ReportHeader`). "Estoque atualizado às…" continua na tela Estoque (outro dado). **Filtros do cabeçalho** (2026-09-29, padrão `DataTablePage`): tamanho md (Período, Turno, Exportar), à direita no desktop e um abaixo do outro no celular; **Exportar** = `Button` secondary sem ícone. `LastUpdated` em `src/pages/dashboard/`, recarrega com `SALES_SYNCED_EVENT`); o **sino de Notificações** — **desde 2026-10-01 = avisos de novidade + problemas que pedem ação (sem sincronização de vendas)**, decisão do dono: o horário das vendas já está no botão Atualizar e a sincronização a cada 30 min abafava o que importa. **Avisos:** tabela global `announcement` (título · texto · link opcional para uma rota do app · `roles` null = todos · `published_at`; migration `20261001140000_announcement`; RLS leitura de publicados para autenticados; **publicação pela equipe WDash via SQL/script com service_role, sem tela**). Item = bolinha primária se não lido + título + texto + "Hoje/Ontem/DD/MM"; clicar marca como lido e abre o link (sem link = continua aberto). Lido/Limpar = mesmo estado na conta (`membership.notif_*`, ver abaixo). **Problemas (só Gestor, fixos no topo enquanto durarem, não são lidos nem limpos):** "Millennium desconectado" / "A senha do Millennium não é mais válida" (lido de `erp_credential`), ícone de alerta em vermelho, clique → Integrações. Bolinha vermelha do sino = aviso não lido ou problema ativo. Vazio = "Nenhuma notificação". Peças: `src/data/wedash/notifications.ts` + `useNotifications` (`syncHistory.ts`/`useSyncHistory` removidos; o worker ainda grava `payload.noSalesChange`, sem uso na UI). `DropdownItem.description` = texto menor abaixo do rótulo. Registro do comportamento anterior (2026-09-25 a 2026-09-30) — **histórico de sincronizações**: últimas 20 de `sync_job` (menu com scroll, `Dropdown.menuClassName`), mensagem curta + horário à direita — "Vendas atualizadas" (Atualizar manual/automático/SEED), "Histórico de vendas carregado · 01/08 a 31/08", "Vendas de 24/09 consolidadas" (madrugada), "Não foi possível atualizar as vendas" (só falha manual; falha automática e de carga ficam só em Logs). **Rodada automática (30 min) só notifica com venda nova** (2026-09-30): o worker compara a Lista de cada loja com a última vista no mesmo dia (`listaFingerprint` + `ListaMemo.seen`, em memória; dia novo ou worker reiniciado = conta como nova só se houver venda); nada mudou em nenhuma loja (hoje e dias pendentes) → job grava `payload.noSalesChange` e o sino ignora. Atualizar manual sempre aparece. **Lido por item (2026-09-28; substitui "abrir = ler e limpar"):** a lista fica (últimas 20); não lida = texto e bolinha na cor primária (sem card — testado e descartado em 2026-09-28); clicar marca como lida sem fechar o menu (salvo no banco por pessoa, ver abaixo; o que terminou antes do 1º uso já conta como lido). Caixa com altura para ~5 itens + rolagem. **Cabeçalho fixo** (2026-10-01): "Notificações" + atalhos **Marcar como lidas** (desabilitado sem não lidas) e **Limpar** (esconde as notificações atuais só para a pessoa; as próximas aparecem normalmente; nenhuma sincronização é apagada). Só a lista rola (`Dropdown.bodyClassName`). **Lidas e limpas acompanham a pessoa em qualquer aparelho** (2026-10-01, decisão do dono; antes só no aparelho): colunas `membership.notif_read_before` · `notif_cleared_before` · `notif_read_ids` (pessoa × empresa; migration `20261001120000_notification_state`) + RPCs `notification_state` (no 1º uso começa com o que o aparelho já tinha) · `notification_mark_read` · `notification_mark_all_read` (`p_clear` = Limpar). Releitura junto com o histórico (60s, ao terminar sync e ao voltar para o app). localStorage fica só como cópia (demo sem banco e resposta imediata ao clicar). Menu com largura fixa de 300px (cabe numa tela de celular de 360px com o sino onde está; atalhos sem quebra de linha). Bolinha vermelha no sino = existe notificação não lida. Vazio = "Nenhuma notificação". Largura padrão do Dropdown. `syncHistory.ts` + `useSyncHistory` (poll 60s, ao terminar sync e ao voltar para o app); gira enquanto sincroniza; erro = toast). Ao terminar dispara `SALES_SYNCED_EVENT` (`wedash:sales-synced`) e cada tela com dados do ERP recarrega. Lógica do FORCE em `useForceRefresh` (`src/pages/dashboard/`).
 - Equipe de vendas (SELLER) não vê o botão; a "Última atualização" aparece nas telas.
 - **Toast ao concluir toda ação manual que vai ao Millennium** (2026-09-28): Atualizar do Topbar = "Vendas atualizadas." (só o clique do usuário, inclusive quando retoma ao reabrir o app; rodada automática não mostra toast) · Atualizar dos Colaboradores = "Colaboradores atualizados." · Atualizar custos = "Custos atualizados." (ou aviso de quantos seguem sem custo). Falha = toast de erro.
 - **Tema** fica em Conta > Meu perfil (card Tema: Claro · Escuro · Automático; vale só para o aparelho — ver #43).
 - **Padrão = Automático** (2026-10-01, decisão do dono; antes Escuro): segue o modo claro/escuro do sistema do aparelho (não o horário). A chave antiga `vela-theme` era gravada sozinha com "dark" em todo aparelho e passou a ser ignorada (todo mundo volta para Automático 1×).
 - **Escolha acompanha a pessoa em qualquer aparelho** (2026-10-01, decisão do dono; substitui "vale só para o aparelho"): `identity.theme_preference` (light/dark/system; null = nunca escolheu = Automático; migration `20261001130000_identity_theme`). Meu perfil grava na conta (`saveThemePreference`); o `AppShell` lê ao abrir e ao voltar para o app (`fetchThemePreference`) e aplica. Conta sem escolha + aparelho com escolha (`localStorage` `wedash.theme`) → leva a do aparelho para a conta. `wedash.theme` = cópia para abrir já no tema certo. Antes do login (login, Crie seu acesso, onboarding) não há conta → Automático / cópia do aparelho. Texto do card: "Escolha como a WDash aparece para você em todos os aparelhos. No modo Automático, seguimos a configuração do sistema de cada aparelho."

32. ✅ **Produtos em dados reais** (2026-09-24) — `buildProductsView(escopo, aggs)` (a fixture saiu). Mesmo padrão do Financeiro e da Visão Geral: filtros = só Período + Exportar (**sem Marca**, sem Atualizar próprio); aviso da carga do mês; sem faixa WPINK (só no Financeiro, 2026-09-26); vazio por card; valores em `brlCent`; recarrega com o Atualizar do Topbar.
 - **Copy revisada (2026-10-01, spec do dono):** subtítulo "Acompanhe vendas, margem e desempenho dos produtos." · badge do Faturamento por categoria = "Faturamento das categorias em relação ao mês passado: R$ …" (a soma das categorias vem do relatório de cupom, não é exatamente o faturamento total; prop `metrica` do `BadgeVsAnterior`) · **Top linhas = mesma estrutura do Top produtos** (Itens vendidos · Faturamento · **Lucro bruto** · Margem; `ProductLineRow.lucro`) · rodapé fixo "Fora das linhas: … em skincare, cabelo…" **removido** (lista fixa podia mentir; `semLinhaFaturamento` segue calculado para uma versão dinâmica futura) · **Desempenho por produto ganhou a coluna CMV** (também no Total do filtro), dica "Acompanhe faturamento, CMV, lucro bruto e margem de cada produto no período. Quando aparecer "—", faltam dados de custo…" · busca "Buscar por produto ou código…" · dica da Variação do total "Faturamento total dos produtos do filtro em relação ao mês passado." (sem "Cada produto pesa pelo quanto vende").
 - **Badge de quantidade sempre com unidade** (regra global, 2026-10-01): dica = "Em relação ao mês passado: 1.234 itens." / "840 vendas." / P.A. "1,57 itens por venda" — nunca o número solto. `kpiDelta(atual, anterior, vs, unidade)` com `unidade` = `"brl"` (padrão) · `"itens"` · `"vendas"` · `"pa"`; margem segue em % (`kpiDeltaPp`). `tipDelta(delta, metrica?)` faz o prefixo da métrica ("Faturamento das categorias em relação…").
 - **KPIs:** Faturamento · Lucro bruto · Margem = os mesmos números e badges do Financeiro; **Itens vendidos** (`sales_day_agg.item_count`) com a mesma regra de comparativo.
 - **Faturamento por categoria + Curva ABC:** `sales_category_day_agg` ({2C46ADF5}). O badge do card compara o total das categorias com o período anterior.
 - **Faturamento do produto** (2026-10-08): Desempenho por produto, Top produtos e o detalhe usam o TOTALVENDA do relatório de margem quando ele existe (é o mesmo valor da Lista). O cupom fica só quando a margem não trouxe a venda. Na loja 00386 o relatório de cupom não devolve a maior parte das vendas; o detalhe do movimento gravava preço R$ 0 com a quantidade certa, o CMV entrava cheio e o lucro bruto saía negativo. Quiosque não muda: lá o cupom já bate com a margem.
 - **Produtos (Top produtos + Desempenho por produto):** `sales_product_day_agg` ({E7A5C5C7}), agrupado por `COD_PRODUTO`. **Saíram** Categoria, Nº de vendas e Ticket (não existe dado por produto; o antigo `estimarVendas` inventava números). **Top produtos** (tela Produtos, 2026-09-30) = # · Produto · Itens vendidos · Faturamento · **Lucro bruto** (vermelho se negativo, "—" sem custo) · Margem; todas as colunas numéricas escolhem os 5.
 - **Desempenho por produto = lista no formato do Top produtos** (2026-09-28): # · Produto (avatar + nome + código) · Itens vendidos · Faturamento · Lucro bruto (2026-09-29; vermelho se negativo) · Margem · Variação (cabeçalhos ordenam) + linha Total do filtro (Variação do total = faturamento somado dos produtos do filtro × período anterior, ponderada — não média simples; 2026-09-29) + busca "Buscar..." + paginação. Mesma tabela no celular (scroll-x; sem cards nem "Ordenar por"). Sem Exportar CSV.
 - **Detalhe do produto** (clique na linha, **no Desempenho e no Top produtos**): `Modal` lg com `buildProductDetail` (calculado no navegador a partir dos agregados já carregados, sem busca nova) — Faturamento · Itens · Preço médio · Participação · CMV · Lucro bruto · Margem, com badges vs período anterior (mesmo recorte da Variação: período terminando hoje compara até ontem nos dois lados; margem só com custo nos dois lados) · gráfico de faturamento por dia (2–31 dias) ou por mês (> 31; oculto em 1 dia) · Vendas por loja (só com mais de 1 loja no escopo: R$, itens, % do produto). Nada estimado: sem custo em algum dia → "—".
 - **Detalhe da linha** (clique no **Top linhas de produto**, 2026-09-29): mesmo modal (`buildProductLineDetail` = soma dos produtos da linha, `ProductLineRow.chaves`) + seção **Produtos da linha** (tipos vendidos + tabela no padrão do Top produtos: # · Produto · Itens vendidos · Faturamento · Lucro bruto · Margem, cabeçalhos ordenam). **Lucro bruto nas listas do detalhe** (2026-09-30): Produtos da linha, Produtos da categoria e Categorias da classe ABC ganharam a coluna (mesma conta e regra "—" do produto; vermelho se negativo). Clicar num produto abre o detalhe dele com "← Voltar para LINHA".
 - **Detalhe da classe da Curva ABC** (clique na Classe A/B/C, 2026-09-29): mesmo modal (`buildAbcClassDetail` = soma dos produtos das categorias da classe) + tabela **Categorias da classe** (# · Categoria · Itens · Faturamento · Margem · Participação + acumulado). Clicar numa categoria abre o detalhe dela (`buildCategoryDetail`, com **Produtos da categoria**) e daí o produto. Produto → categoria = `product_catalog.type_id` pelo id do ERP (`fetchProductCatalogTypes`, mesmo join da `sales_category_day_view`; fora do catálogo = INDEFINIDO). O detalhe guarda uma pilha; "← Voltar para …" volta um nível. Clicar numa barra do **Faturamento por categoria** abre o mesmo detalhe da categoria (`BarChart.onSelect`).
 - **Mesmo detalhe na Visão geral** (2026-09-29): barras do Faturamento por categoria e linhas do Top produtos abrem o detalhe (com Produtos da categoria → produto e "← Voltar"). Peça única `useProductDetail` (`src/pages/dashboard/ProductDetail.tsx`: modal, pilha e `fetchProductsAggInput`); Produtos passa os próprios dados, a Visão geral **busca os dados de Produtos só no 1º clique** (skeleton no modal; guarda até mudar o filtro ou chegar venda nova). Detalhe abre por chave (`ProductSelection`: produto = `COD_PRODUTO`/`#id`, categoria = id ou nome, linha = nome, classe).
 - **CMV por produto** (migration `20260924235900_sales_product_cost_day_agg`): tabela `sales_product_cost_day_agg` (loja × dia × `COD_PRODUTO`: qtde, receita, CMV). Vem do **mesmo** fetch do RELATORIOMARGEM que já grava marca/CMV (**nenhuma chamada nova ao ERP**). O worker grava no split de marca e no `syncCmvForRange`, com soft-fail (WARN "CMV por produto" em Logs).
 - Lucro bruto do produto = faturamento − CMV − ICMS% × faturamento − ICMS ST% × CMV (impostos da loja).
 - **Nada estimado:** se algum dia com venda do produto não tem custo gravado, CMV, Lucro e Margem do produto mostram "—". O Total da tabela também mostra "—" se algum produto do filtro estiver sem custo.
 - **Produto com custo R$ 0 no Millennium** (2026-09-26, decisão do dono): custo zero que **veio** no RELATORIOMARGEM é dado do ERP, não falta de dado → conta como R$ 0 (faixa WPINK deixa de mostrar "—" quando o dia tem margem gravada em `sales_product_cost_day_agg`). Financeiro e Produtos mostram aviso amarelo de 1 linha (ícone de alerta) entre os filtros e os KPIs: "N produtos estão sem custo no Millennium. Isso pode deixar o CMV e a margem incorretos." + "Ver produtos" (código · nome do catálogo · itens · R$). Só entra no aviso o produto que segue zero **depois** do preenchimento pela tabela de custo da loja (abaixo). ~~"Recarregar custos"~~ (recarga dos dias pela fila) removido. **"Atualizar custos"** (2026-09-26, só Gestor): para depois que o suporte do Millennium cadastra o custo — como o custo da margem não é histórico, buscar de novo traz o custo atual também para vendas antigas. Síncrono (Edge `erp-products-sync`, `scope: "costs"`, lojas do StorePicker + período da tela): preços da tabela de custo de cada loja afetada (1 chamada por tabela) + margem do período por loja afetada (1 chamada; > 92 dias = 1 por mês) → linha com custo 0 que passou a vir com custo recebe itens × custo unitário em `sales_product_cost_day_agg` e a diferença no ALL e na marca de `sales_day_agg`; preço novo na tabela entra pelo preenchimento na leitura. Telas recarregam (`SALES_SYNCED_EVENT`); segue sem custo → toast "O Millennium ainda está sem custo para N produtos". Caso real: WP ULTRA (`WP014`) na 00205 (12/09 = única venda WPINK do dia) e ~24 códigos em ago–set, a maioria na 00114. `ProductsWithoutCostNotice` + `FinanceView.produtosSemCusto`.
 - **Tabela de custo da loja** (2026-09-26, decisão do dono; migration `20260926200000_product_cost_table`) — o custo da margem **não é histórico** (re-buscar dia antigo devolve o custo de hoje) e o zero persiste no ERP, então re-buscar o dia não resolve. As tabelas de custo do Millennium (lookup `tabela_custo.TABELA` + report `{9701602B}` com `TABELA_DE_CUSTO`, filial vazia = tabela inteira, ~3s) têm o preço desses produtos.
 - Globais (como o catálogo): `product_cost_table` + `product_cost_table_price` (código → custo unitário > 0; mesmo código em várias cores = maior). Loja: `store.cost_table_id` + `cost_table_set_at`.
 - **Recarga única de produtos** (2026-09-26, substitui a varredura de 12h; migration `20260926210000_product_refresh_unified`): tipos + catálogo (#34) + lista de tabelas + preços de **todas** as tabelas, sempre juntos (~29 chamadas, ~36s; medido: 19 tipos · 580 produtos · 8 tabelas · 3.285 preços). Mesmo lease global do catálogo (`product_catalog_sync`; o controle próprio das tabelas saiu). **Sem timer.** Só dispara quando: (1) catálogo ou tabelas vazios (1º onboarding da rede); (2) venda com `COD_PRODUTO` desconhecido (máx. 1× a cada 15 min na rede); (3) produto vendido com custo 0 na margem e **sem preço na tabela da loja** — segue sem preço → `product_cost_miss` (24h sem nova busca; hoje só o `504`). Worker: `productCatalog.ts` (`refreshProducts` / `ensureProductCatalog`, chamado ao gravar top produtos e a margem). ERP recusou → soft-fail (WARN), dados antigos seguem.
 - **Recarga separada por gatilho** (2026-09-29, substitui "sempre juntos" acima): cada gatilho busca só a sua parte (`refreshCatalog` / `refreshCostTables`), até **2 chamadas simultâneas** (`CATALOG_CONCURRENCY`; o Atualizar pode ter outra frente no ERP). Produto desconhecido / catálogo vazio → tipos + produtos + cadastro Saldo Atual e Futuro (~21 chamadas, ~5s; o custo de produto novo já vem na margem). Tabelas vazias → lista + preços de todas (~9 chamadas). Custo 0 sem preço na tabela da loja → **só os preços dessa tabela** (1 chamada, ~3s). 1º onboarding da rede = as duas partes. Mesmo lease e mesmo limite de 1× a cada 15 min na rede. Log do worker diz o que recarregou ("N produtos" · "N tabelas de custo" · "tabela de custo da loja").
 - **Detecção automática** (`costTableSync.ts`, só banco, sem ERP): roda no job depois de gravar a margem da loja (máx. 1×/h por loja em memória); loja sem tabela escolhida (`cost_table_set_at` null) recebe a tabela com mais custos unitários iguais (±1 centavo) ao último custo da margem por produto (mín. 20 produtos e 50% dos comparados). Escolhida (automática ou manual) = fixa. Santana: 00010/00114/00205 → **104 (Centro-Oeste)**. Loja sem margem com custo (00386) fica sem tabela até ter.
 - **Troca manual**: Configurações da operação > **Produtos e impostos** > card da loja > **Tabela de custo dos produtos** (2026-09-28; antes card no detalhe da loja) (Select + Resetar/Salvar do card; gravar marca `cost_table_set_at` e a detecção não mexe mais). ~~Botão **Atualizar tabelas**~~ **removido da tela (2026-09-28, decisão do dono)** — a lista de tabelas (opções do Select) vem da recarga de produtos do worker; forçar a atualização das tabelas vai para Administração > Lojas depois (Edge `erp-products-sync` com `scope: "tables"` continua pronta, 1 chamada). **Salvar** = busca os preços **só da tabela escolhida** (`scope: "table", tableId`, 1 chamada ~3s) e então grava a escolha; ERP falhou → não salva e mostra o erro. "Nenhuma" salva sem chamar o ERP. A partir daí o CMV da loja (inclusive dias passados, porque o preenchimento é na leitura) usa os preços dessa tabela. Nenhum dos dois mexe no catálogo nem no "cadastro atualizado em".
 - **Custo nunca no catálogo** (decisão do dono, 2026-09-26): `product_catalog` é compartilhado entre lojas de estados diferentes, cada uma com a sua tabela de custo → custo só em `product_cost_table_price` (tabela × código) e a loja aponta para a tabela (`store.cost_table_id`).
 - **Preenchimento na leitura, silencioso** (`costTableFill.ts` + `salesRepo`): linha da margem com CMV 0 e itens > 0 → itens × custo da tabela da loja; soma em `sales_product_cost_day_agg` e em `sales_day_agg` (ALL + marca pelo código, WP* = WPINK). Sem anotação na UI; o produto sai do aviso sozinho. Soft-fail (sem tabela = zero como antes).
 - Validado: 154 de 162 linhas sem custo (ago–set) preenchidas; segue no aviso só o `504` (zero em todas as tabelas; 48,37 na margem da 00010 em outros dias).
 - ~~**Configurações > Produtos**~~ **removida (2026-09-26, decisão do dono)**: o cadastro se atualiza sozinho (gatilhos acima), o custo vem da tabela escolhida no card Custo dos produtos da loja e os produtos sem custo já aparecem no "Ver produtos" do aviso. `/settings/products` redireciona para Lojas. Edge `erp-products-sync` ficou só com `tables` / `table` / `costs` (sessão salva, 401 → login com a senha cifrada; mesmo lease do catálogo, sem mexer no "atualizado em"). Lógica ERP espelhada em `supabase/functions/_shared/millenniumProducts.ts` ↔ `workers/millennium-sync/src/millenniumCatalog.ts` (manter iguais). Tokens de marca `--wepink` (rosa) / `--wpink` (roxo) no `index.css` (fixos, não seguem o acento do tenant) = cores das fatias do donut **Faturamento por marca** do Financeiro.
 - **Comparativos sem hora** (categorias e variação por produto): se o período termina hoje, compara **até ontem** nos dois lados; em "Hoje" fica sem badge/variação.
 - ✅ **Top linhas de produto** (2026-09-25, `productLines.ts`): o Millennium não tem campo de linha → linha = **fragrância tirada da descrição**. Remove o tipo do começo (desod. colônia, body splash, body cream, roll-on, The Oil, The Cream, perfume capilar, body scrub/butter, espuma de banho, sabonete), o tamanho e "- WEPINK"; agrupa pela 1ª palavra (2 quando a 1ª é MY/THE/LE); nome da linha = começo comum das fragrâncias do grupo **no catálogo inteiro** (estável entre períodos: ONE TOUCH, FANTASY KIDS, LE GRAND CLUB; conectivo final sai: FUSION FOR HER/HIM → FUSION). Grafias do ERP unificadas (GADHAN→GHADAN, INFINTY→INFINITY, VIRGINIA→VF…). Calculado na leitura (regra nova corrige o histórico). Produto sem tipo de fragrância (skincare, cabelo, maquiagem, suplementos, kits) fica fora — rodapé "Fora das linhas: R$ X". Card = Top 5 no formato do Top produtos (Linha · Itens · Faturamento · Margem; mesma regra de ordenação; "N produtos · N tipos" com tipos no tooltip). Margem "—" se algum produto da linha está sem custo. Consequência da regra "mesmo nome": FATAL junta Black For Her/Rouge/White; PERFECT junta Pear/Peach; VF junta todas as VF.

33. 🟡 **Atualizar sem detalhe da movimentação — Produtos por Cupom** (fechado 2026-09-25; **worker + Edge implementados 2026-09-25**, falta migration `20260925120000_seller_gerador` + deploy das Edges + confirmar `GERADORES[0].GERADOR` no ERP) — substitui o ConsultaDetMov (1 chamada por cupom) por 1 chamada por loja/dia.
 - **Implementado:** `millenniumCouponReport.ts` (parse/fetch). FORCE por loja = (Lista → margem/marca) ‖ cupom ‖ categorias. Marca por cupom = relatório; cupom da Lista fora do relatório → cache `sales_coupon_brand` → DetMov só dele (log `X pelo relatório de cupom · Y no cache · Z no detalhe`). Relatório falhou inteiro → volta ao caminho antigo (DetMov + cache) com WARN "Produtos por cupom". Top produtos = itens dos cupons que estão na Lista (dia = o da Lista). R$ da equipe continua da Lista; do relatório vêm o gerador e o nome atual (`sales_seller_day_agg.seller_gerador_id`). `link_seller_day_aggs` liga por gerador (qualquer loja do tenant) e depois por nome. Módulo `{E7A5C5C7}` removido do worker; check de permissão troca `top_produtos` por `cupom`.
 - SEED: sincroniza a equipe inteira de cada loja antes do Atualizar.
 - **Relatório:** **WE PINK - PRODUTOS POR CUPOM E VENDEDOR** `{52DE7BBC-78D4-7765-A232-A5MAD2840284}` (personalizado → entra no check do onboarding / Integrações; `{E7A5C5C7}` sai do check e do Atualizar). Filtros: `DATA_DATA_DATA_INTERVAL: 0` + START/END · `VENDA_MOVIMENTO_NFS: ""` · `FILIAL_GERADOR_GERADOR: "(gerador)"` · `PRODUTO_PRODUTO_PRODUTO: null`.
 - **Campos:** `VENDA_MOVIMENTO_NFS` · `VENDA_MOVIMENTO_COD_OPERACAO` · `VENDA_MOVIMENTO_TIPO_OPERACAO` (= chave do cache de cupons) · `PRODUTO_PRODUTO_COD_PRODUTO` · `F_3887607047` qtd · `F_366619977` receita · `FUNCIONARIO_GERADOR_GERADOR` + `FUNCIONARIO_GERADOR_NOME` · `VENDA_MOVIMENTO_CANCELADA` · tabela de preço / bonificado / brinde. `DATA_DATA_DATA` = só a data (sem hora).
 - **Validado:** loja 205 dia 24/09 via API = 1 chamada, 0,7s, 36 cupons; os 16 cupons já no cache do DetMov batem 100% por marca. Planilha 010 agosto: 3.165/3.165 cupons batem com a Consulta Movimentações (valor, itens, vendedora); 0 cupons com 2 vendedoras.
 - **Não traz venda sem vendedora** (ex.: 15533 SMART R$ 90,90, de qualquer marca) → **fallback:** cupom da Lista que não veio no relatório = 1 ConsultaDetMov só dele (1 em 3.166 em ago/010). Fica fora do ranking da equipe.
 - **Atualizar por loja:** (Lista → margem) ‖ Produtos por Cupom ‖ categorias. Cruzamento local: item ↔ venda da Lista pela chave `COD_OPERACAO|NF|TIPO` → hora; marca pelo código (WP* = WPINK; Skincare/Sacola/resto = WEPINK); vendedora pelo código de gerador. Top produtos = itens somados por produto. Receita/CMV por marca e CMV por produto seguem na margem. Cache `sales_coupon_brand` deixa de ser necessário.
 - **Equipe pelo código de gerador:** o relatório traz `FUNCIONARIO_GERADOR_GERADOR` (ex.: 66161), ≠ `millennium_employee_id` do cadastro (61643). O gerador vem em `GERADORES[]` do `FUNCIONARIOS.Consulta` (já chamado no sync) → guardar no `store_seller` (coluna nova; confirmar o campo na implementação). Nome exibido atualizado pelo nome do relatório (sem chamada). Troca de nome no ERP não quebra meta/histórico.
 - **Sync da equipe só com vendedora nova** (sai o gatilho de 24h): código de gerador desconhecido → `FUNCIONARIOS.Lista` (1 chamada; não traz gerador) + `Consulta` só de quem não está no cadastro (ou sem gerador guardado). Status Ativo/Inativo = botão Atualizar do card da equipe. Código que segue desconhecido → fora do ranking + WARN.
 - ✅ **Carga do histórico em período** (implementado 2026-09-25, `closedMonth.ts`): na carga do histórico, **todo dia anterior a hoje** (inclusive do mês atual, desde 2026-09-25) vira 1 job do mês calendário (do dia até o limite da carga, dentro do mesmo mês). Por loja: **Lista 1×**, Produtos por Cupom **1×** e margem **1×** no período (margem só para o custo unitário) = 3 chamadas por loja no mês; os dias são gravados um a um (do mais recente para o mais antigo) a partir dessas respostas. Lista do mês falhou → Lista dia a dia (WARN "Vendas do mês falhou"). Margem de cada dia = itens reais do dia (relatório de cupom + detalhe das vendas sem vendedora) × custo unitário do mês. **Sem acerto** pelo total da margem (decisão do dono: "nada estimado"; aceita ~R$ 16/mês de brinde de cupom fora da Lista). Falta relatório, custo ou código de produto → margem daquele dia pela chamada normal. Relatório/margem do mês falhou → segue dia a dia (WARN em Logs). Mês atual, Atualizar e fechamento noturno **não** usam esse modo.
 - **Atualizar passa na frente:** entre um dia e outro, se há FORCE/SEED na fila da credencial, o job termina e encadeia a partir do dia seguinte da carga.
 - **Lista do mês inteiro** (teste 2026-09-25, ago/26, 1 loja por vez): 31/31 dias idênticos ao gabarito nas 3 lojas (vendas, R$, itens, horas, formas). ~3s por loja; **a 1ª consulta após o login é lenta** (148s → 25s → 6s na 1ª rodada, depois ~3s) — por isso timeout de 5 min. O travamento de 24/09 foi com 3 lojas **em paralelo**.
 - Teste só leitura (ago/26, lojas 205/010/114) × gabarito dia a dia: 28–31 dias idênticos; CMV e WPINK do mês = soma dos dias; custo não mudou dentro do mês; cupom do mês ~3s (loja maior, 3.165 cupons), margem 4–6s. Diferenças só de brinde R$ 0 em cupom sem vendedora.
 - **Status de NFe descartado** como substituto da Lista (testado ago/010): cobre as 3.166 notas, mas **sem forma de pagamento**, sem venda sem nota (SMART R$ 53,80) e com hora de processamento (12/3.166 em outra hora; contingência de 28/08). Não traz vendedora.
 - **Sessão única por usuário ERP (suspeita, 2026-09-25):** login no navegador com o mesmo usuário derrubou o token do worker (401) duas vezes. Reforça usuário ERP dedicado à WDash. Checkbox do onboarding e de Integrações agora explica: "Este usuário será exclusivo da WDash" + "O Millennium permite apenas uma sessão por usuário. Para evitar interrupções na sincronização, use um usuário criado exclusivamente para a WDash."
 - **Gerador da loja salvo** (2026-09-25): `store.millennium_gerador_id` (mesma migration `20260925120000_seller_gerador`). O lookup `filial.GERADOR.gerador` só roda no job quando alguma loja ainda não tem o gerador; o que achar é gravado na loja.
 - **Onboarding confirmado pelo dono (2026-09-25):** hoje + equipe no SEED; depois carga do mês atual e, em seguida, do mês anterior; atualização automática ligada (30 min) por padrão.
 - ✅ **Validado em produção (2026-09-25, onboarding Santana refeito):** `GERADORES[0].GERADOR` confirmado (GABRIELA 61643 → gerador 66161); equipe das 4 lojas com gerador salvo; 24/09 da loja 205 completo (36 cupons, WPINK R$ 385,60); todas as vendas de ontem ligadas à vendedora pelo cadastro; 0 avisos em Logs. Carga inicial 4 lojas = 17s / 21 chamadas; ontem = 14s / 16 chamadas.

34. ✅ **Catálogo de produtos (categoria) — implementado 2026-09-25** (migration `20260925160000_product_catalog`) — tabela **compartilhada entre tenants** (mesma franquia, mesmo Millennium), chave = `COD_PRODUTO`, com tipo (categoria). Resolve a categoria da importação por planilha e tira `{2C46ADF5}` do Atualizar e do check.
 - **Implementado:** `millenniumCatalog.ts` (lookups) + `productCatalog.ts` (`ensureProductCatalog`: vazio / desconhecido → recarga; lease `claim_/release_product_catalog_refresh`; `product_catalog_miss` 24h). Chamado ao gravar o top produtos (Atualizar, fechamento, carga). Categoria nas telas = view `sales_category_day_view` (security_invoker; fora do catálogo = INDEFINIDO). `{2C46ADF5}` saiu do worker (módulo apagado), de `CUSTOM_REPORTS` e do mock; `sales_category_day_agg` fica só como histórico (ninguém lê nem grava).
 - **Venda sem vendedora no top produtos:** itens do DetMov guardados em `sales_coupon_brand.items` (jsonb) → reaproveitados sem nova chamada; loja sem WPINK também grava. Teto de 10 cupons fora do relatório por loja/rodada (mais que isso = relatório incompleto, WARN em vez de N chamadas).
 - **Validado:** carga = 20 chamadas / 4,6s · 19 tipos · 580 produtos. 24/09 e 25/09 das 4 lojas: catálogo × `{2C46ADF5}` = **100% igual** (R$ e itens por categoria).
 - Atualizar por loja agora = (Lista → margem) ‖ cupom (máx. 2 chamadas simultâneas).
 - **Sem relatório de cadastro** (suporte não tem) → Plano B abaixo (lookups).
 - **Tabelas globais (sem tenant):** `product_type` (19 tipos) + `product_catalog` (`COD_PRODUTO`, id ERP, descrição, tipo, first_seen/updated_at). Só o worker grava (service_role). Premissa: todos os tenants no mesmo Millennium; se entrar outra rede/servidor, ganha coluna "rede".
 - **Carga = sempre inteira:** 1 lookup de tipos + 1 por tipo (~20 chamadas, ~4s). Não existe consulta de 1 produto com tipo.
 - **Quem busca = o primeiro job que precisar:** linha de controle global (atualizado em / lease ~2 min). Pega a vez com update condicional; os demais seguem com o catálogo atual.
 - **Quando (decisão do dono, sem rotina semanal):** catálogo vazio (1º tenant da rede, no onboarding) · Atualizar vê `COD_PRODUTO` desconhecido nos itens do relatório de cupons → recarrega (máx. 1×/job e 1× a cada 15 min na rede). Continua desconhecido → "Indefinido", sem nova busca por 24h (cache negativo). ERP recusou → soft-fail (WARN em Logs), catálogo antigo segue.
 - **Categoria na LEITURA** (decisão do dono): `sales_product_day_agg` × `product_catalog` agrupado por tipo (view/RPC no banco). Produto que entra depois ou muda de tipo corrige o histórico sozinho.
 - **Venda sem vendedora** (fora do relatório de cupons): itens vêm do ConsultaDetMov desses poucos cupons (já é o fallback) → entram em `sales_product_day_agg` e na categoria.
 - **Desligar `{2C46ADF5}`** (Atualizar, carga do mês, `CUSTOM_REPORTS`) só depois de validar 1 dia (ex.: 24/09 das 4 lojas): categoria pelo catálogo × relatório.
 - **Plano B (testado 2026-09-25, lookups comuns, ~0,1–0,5s cada):**
 - `PRODUTO.tipo.tipo` → 19 tipos (`PRODUTO_TIPO_TIPO` / `_DESCRICAO`) — mesmos códigos do `{2C46ADF5}` (9 Skincare, 12 Body Cream, 13 Perfumaria, 14 Body Splash, 101 Bath&Body, 20103 Whey…; -2000000000 e 16 = INDEFINIDO).
 - `produto.produto.produto` → só id · `COD_PRODUTO` · `DESCRICAO1` (sem tipo/divisão). Sem filtro = 578 produtos; `PARAM_9` = filtro de tipo (14 → 171 produtos, Body Splash). Catálogo = 1 chamada por tipo (~19, ~4s).
 - `PRODUTO.divisao.divisao` → 2 SKINCARE · 101 WPINK SUPLEMENTOS · 102 WEPINK · 301 SACOLA (não usado: marca = WP*).
 - `PRODUTO.tipo_produto.tipo_prod` = natureza (Acabado / Matéria-prima…) — **não** é categoria.
 - Antes de desligar `{2C46ADF5}`: conferir categorias do catálogo × relatório num dia.

35. ✅ **Atualização automática (opcional) substitui o D-1** (fechado 2026-09-25, **implementado 2026-09-25**, migration `20260925150000_auto_refresh`) — religa o automático (o LIGHT de 5 min foi desligado em 23/09) como opção do cliente.
 - **Sempre ligado, fixo 30 min, sem chave na UI** (2026-09-25; reconfirmado 2026-09-28 — a chave "Atualizar vendas automaticamente" no modal do Millennium foi criada e removida no mesmo dia, decisão do dono). Rodada automática que falha (sessão caída, usuário ERP em uso em outro lugar) = **falha silenciosa** (sem toast, sem Logs). `erp_credential.auto_refresh_enabled` (default true) fica só como desliga de suporte (direto no banco); `auto_refresh_interval_min` não é lido.
 - **Implementação:** `erp_credential.auto_refresh_enabled` (default true) + `auto_refresh_interval_min` (legado). `store.last_closed_day` (último dia fechado) + `store.last_sync_at` (último Atualizar ok da loja). Regras puras em `src/data/wedash/autoRefresh.ts` (worker re-exporta).
 - **Expediente de volta** (2026-09-30, decisão do dono; substitui o "24h" abaixo): rodadas a cada 30 min **só nas lojas no expediente** (Configurações > Loja, fuso da loja) + **última rodada do dia no fechamento + 30 min** (loja com `store.last_sync_at` anterior a esse instante; falhou → nova tentativa a cada 10 min até a meia-noite). Entre o fechamento e +30 min, antes de abrir e na madrugada não roda. **Loja sem horário configurado = sem atualização automática** (só o botão Atualizar) + aviso amarelo "A loja X está sem horário de funcionamento" com "Configurar funcionamento" nas telas do Dashboard (`StoreHoursNotice`, só Gestor) e "Horário de funcionamento não configurado" / "Sem o horário configurado, as vendas desta loja só são atualizadas pelo botão Atualizar." no card da loja em Configurações > Loja (2026-10-02: o problema se chama sempre **horário de funcionamento não configurado** — nunca "atualização automática desligada", que sugere uma chave que não existe). **Copy de Configurações > Loja (2026-10-02, spec do dono):** subtítulo "Configure o fuso horário e o funcionamento de cada loja." · texto da seção Funcionamento "Define quando as vendas são atualizadas automaticamente. Também organiza as vendas por hora nos gráficos e distribui a meta do dia pelas horas." · rótulo **Dias e horários** (antes Horário) · "Copiar horário para os outros dias abertos" · seletores com rótulo acessível "Abertura de segunda-feira" / "Fechamento de…" · erro "{DIA}: o horário de abertura deve ser anterior ao horário de fechamento." Nome da tela segue **Loja** (vai receber outras configurações da loja; Funcionamento é a seção). Formulário compartilhado com o detalhe da loja (Administração > Lojas). **O dia fecha sempre na madrugada** (CLOSE, `CLOSE_HOUR`, padrão 3h) — as rodadas do dia não fecham hoje, então às 3h ontem está pendente em todas as lojas (inclusive sem horário) e é buscado de novo (pega venda lançada tarde); se a madrugada não rodar, a 1ª rodada do dia fecha ontem como dia pendente. Regras em `autoRefresh.ts` (`storePhase`, `planAutoRound`, `nextAutoRefreshAt` por loja; tooltip "Próxima atualização" some com todas as lojas fechadas / sem horário).
 - ~~**24h, sem horário de funcionamento**~~ (2026-09-29, decisão do dono; substitui "só lojas abertas + rodada de fechamento"; **revertido em 2026-09-30**): a cada 30 min **todas as lojas**, a qualquer hora. O dia de hoje não fecha mais no fechamento + 30 min: a **1ª rodada depois da meia-noite** fecha ontem como dia pendente (`pendingDays`) e grava `last_closed_day`; a madrugada (CLOSE) segue como rede de segurança. `closeStoreIds` no payload só é respeitado por job antigo na fila. `parseStoreHours`/`storePhase` saíram de `autoRefresh.ts`; tooltip "Próxima atualização" = última rodada + 30 min.
 - Worker varre 1×/min (`enqueueDueAutoRefreshJobs`) e enfileira **FORCE com `payload.auto`**. Não enfileira com outro FORCE/SEED na fila, onboarding aberto, pausado ou senha inválida. **Relógio próprio** (2026-09-25, decisão do dono): a cada 30 min desde a **última rodada automática**, todas as lojas abertas. Atualizar manual **não** conta nem adia. **Rodada perdida** (integração desconectada, worker parado) não precisa de estado guardado: a última rodada fica com mais de 30 min → ao reconectar, a rodada sai em até 1 min (uma só, porque cada Atualizar busca o dia inteiro; dias inteiros perdidos = recuperação por `last_closed_day`).
 - Todo FORCE de topo (manual ou automático) = `runRefreshJob`: dias pendentes (até **3 por rodada**, mais antigo primeiro, chão = dia 1 do mês anterior; loja sem `last_closed_day` = sem pendência) → hoje → fecha o dia das lojas que passaram do fechamento + 30 min. Sessão caída numa rodada automática = job FAILED com marca `[auto-sessao]`, sem login; a próxima vem com `relogin`. **Usuário marcado como exclusivo da WDash (`dedicated`) = login na hora** (ninguém para derrubar; decisão do dono 2026-09-25). Falha de ERP/sessão no automático não grava Logs nem `last_error`.
 - Madrugada (CLOSE) só enfileira lojas com dia pendente (`last_closed_day` < ontem ou vazio) e pula, dia a dia, loja que já fechou o dia; CLOSE e carga do histórico também avançam `last_closed_day`.
 - UI (clean, 2026-09-25): card Millennium só com status + Configurar (+ Atualizar, #44); sem chave de atualização automática; sem aviso vermelho e **sem aviso "sem atualização há 2h"**. Topbar: tooltip "Próxima atualização às HH:MM"; rodada automática que termina faz as telas recarregarem sozinhas (poll de 60s + **ao voltar para o app** — `visibilitychange`/`online`, porque o PWA em segundo plano congela o timer).
 - ~~Onde: Configurações > Integrações, liga/desliga + 15/30/60 min~~ → substituído por "sempre ligado, fixo 30 min" (acima).
 - **Janela por loja:** da abertura ao fechamento (horário + fuso de Configurações > Lojas; loja sem horário = **10h–22h**). Só roda o Atualizar (FORCE de hoje) das lojas abertas naquele momento. Não mexe no botão Atualizar manual.
 - **Última rodada = fechamento + 30 min** → pega o fim do expediente e notas processadas com atraso (ex.: contingência 28/08) e **fecha o dia na mesma noite**.
 - **Job da madrugada (CLOSE, #23b) vira rede de segurança:** só roda para loja/dia que não foi fechado (automático desligado, worker parado, falha).
 - **Sessão única por usuário ERP:** recomendação de usuário ERP exclusivo da WDash fica no check "Este usuário será exclusivo da WDash" do modal (sem bloquear) — mesmo usuário no navegador derruba e é derrubado a cada rodada.
 - Custo estimado: ~48 rodadas × 4 chamadas ≈ 190 chamadas/loja/dia com 15 min (metade com 30).
 - Anotado (sem ação): cancelamento de venda feito depois do fechamento não é pego; se ocorrer na prática, avaliar revisão semanal leve.
 - **Sessão caiu (401) / ERP fora do ar numa rodada automática** (refino 2026-09-25): **pula em silêncio** (sem toast, sem Logs) e **não** refaz login na hora (não derrubar o franqueado que usa o mesmo usuário no navegador). **Rodada seguinte** tenta login 1× com a senha salva: ok → segue e recupera; senha recusada → erro de verdade ("Senha inválida", automático para, pedir reconexão em Integrações). Botão Atualizar manual: 401 → relogin na hora.
 - **Sem buraco dentro de hoje:** cada Atualizar busca o dia inteiro; a 1ª rodada ok traz tudo.
 - **Recuperação de dias:** por loja, guardar o **último dia fechado** (rodada ok depois do fechamento). Toda rodada ok (automática, manual ou madrugada) fecha antes os dias pendentes (do mais antigo ao mais novo) e depois atualiza hoje. Teto: **até o dia 1 do mês anterior**. Poucos dias = Atualizar dia a dia; muitos = caminho da carga do mês (cupom + margem do período, Lista dia a dia). O CLOSE da madrugada vira só mais uma rodada (só trabalha se houver dia pendente).
 - **Sem aviso de atraso** (removido 2026-09-25 a pedido do dono): o frescor aparece só no "Atualizado às…" (última rodada ok); falhas ficam em Logs.
 - **Topbar clean (2026-09-25; 2026-09-26 sem texto):** botão só com ícone; frescor do dado (última rodada ok) = "Última atualização às HH:MM" abaixo dos filtros das telas. "Próxima atualização às HH:MM" fica **só no tooltip** do ícone, e só com automático ligado e loja aberta (depois do fechamento / automático desligado = sem "próxima").

36. ✅ **Gerência / conta de freelancer fora da equipe — pelo cargo do ERP** (2026-09-25; migration `20260925140000_store_seller_role`) — conta genérica da loja que vende no Millennium (ex.: `NORTE.SUL` na 114; ago/26 = 61 vendas · R$ 6.798,91 · 2,9% da loja, 60 delas em domingos). Usada quando vende freelancer ou a gerente → sempre ficava em último e bagunçava o ranking. O dono trocou o cargo dela no ERP para **GERENCIA**.
 - **Sem divisão** (descartados rateio por todos, por turno inferido e por turno cadastrado). As vendas **não vão para ninguém** — nem premiação, nem meta individual. Continuam no faturamento, nº de vendas e meta **da loja** (total bate com o ERP).
 - **Sem chave manual:** a chave "Vendedor central" (`is_central`, migration `20260925130000`) foi criada e removida no mesmo dia. **O cargo do ERP decide.**
 - `store_seller.erp_role` = CARGO da `FUNCIONARIOS.Lista`. O sync guarda **todos** os funcionários da loja (antes descartava ativo sem cargo VENDEDOR) → venda de gerente resolve para o funcionário e não dispara sync da equipe nem aviso "sem cadastro" em Logs.
 - **Equipe de vendas / "N na equipe"** = ativo com cargo VENDEDOR (`isActiveSalesPerson`). `erp_role` **`""` = sem cargo no ERP** (ex.: dono) → fora da equipe; **null = ainda não sincronizado** (legado, conta). Nunca gravar cargo vazio como null. Ativos com outro cargo **não aparecem** (decisão do dono: sem badge).
 - **Ranking** (`fetchSalesSellerDayAggs` → `excludeNonSalesPeople`): tira vendas de funcionário **ativo com cargo ≠ VENDEDOR** (por código → gerador → loja+nome). Inativos ficam (ex-vendedoras; ao desativar o ERP troca VENDEDOR → INDEFINIDO). Vale na hora para todo o período.
 - **Consulta no sync do worker:** pula só quem tem gerador salvo **e o mesmo cargo** de antes; cargo mudou (desativada → INDEFINIDO, virou gerência) → `FUNCIONARIOS.Consulta` de novo. 1º sync após a migration consulta todo mundo 1×. Botão Atualizar do card (Edge) consulta todos.

36b. ✅ **Saudação na tela inicial** (2026-09-26) — a tela que abre após o login (`homeForRole`: Visão geral para Gestor/Gerente) tem título **"Bem-vindo(a) de volta, NOME 👋"** (primeiro nome, em maiúsculas); breadcrumb continua "Visão geral". Minha meta (Equipe de vendas) ganha a mesma saudação quando sair do "em breve".
 - **Copy da Visão geral revisada (2026-10-01, spec do dono):** aviso da busca inicial fala em **vendas** ("As vendas aparecerão automaticamente…", "Não foi possível obter as vendas no Millennium…", botão "Tentar novamente" → "Tentando…") · badge de **Faturamento por categoria** e **Dias da semana x meta** = tooltip "Faturamento total em relação ao mês passado: R$ …" (o badge é do faturamento total, não da categoria; prop `metrica` do `BadgeVsAnterior`) · Atingimento: "{N} metas consideradas" / "Metas de {N} lojas" / "{X} de {Y} lojas com meta" · meta encerrada = Projeção "—" + apoio "Meta encerrada" · tooltips "A meta é distribuída ao longo do período…" e "…com a meta prevista para esse dia." · Ranking com 1 loja = badge "Rede: R$ …" · nível da meta sempre **"N2 · Super"** (linha "82% da meta · N2 · Super", rótulos e dicas da barra) · detalhe da pessoa: "Vendas na meta" / "Vendas do grupo", "Falta para o próximo nível" (também no grupo), "Participação da pessoa no faturamento…" · detalhe do produto/categoria: "Participação do produto/da categoria…" (nunca "Fatia") · falta de dado: "CMV, lucro e margem ficam indisponíveis quando faltam dados de custo no período." / "P.A. e itens vendidos ficam indisponíveis quando faltam dados de itens no período." · Top produtos mantém Lucro bruto (decisão de 2026-09-30).
 - **Campo opcional = "(opcional)" na frente do rótulo** (regra do sistema inteiro, 2026-10-02, decisão do dono): `FormField optional` (e `TierField optional` no editor de Metas) mostra "Rótulo (opcional)" em texto secundário; a ajuda embaixo do campo não começa com "Opcional.". Obrigatório segue com o * vermelho. Aplicado: mínimo da Disputa nos Desafios e Bônus (equipe e gerência) dos níveis das Metas.
 - **Botão em andamento = verbo da ação** (regra do sistema inteiro, 2026-10-01): "Tentando…", "Salvando…", "Atualizando…", "Enviando…", "Desconectando…" — nunca "Aguarde…".
 - **Copy de componente compartilhado é global** (2026-10-01, decisão do dono): os detalhes (modais) de Produto/Categoria/Linha/Classe (Visão geral + Produtos) e de Pessoa (Visão geral + Equipe), a barra de níveis e os cards de meta usam o mesmo texto em todas as telas — sem texto que dependa da tela de origem; navegação interna = "← Voltar para {NOME}". Nível da meta = **"N2 · Super"** em todo lugar (inclusive tabela do ranking do `CardMeta` e "Fechou no N2 · Super" da listagem de Metas). Nas revisões de copy, o dono separa o que é exclusivo da tela do que é global.

37. ✅ **Período padrão = Hoje, compartilhado entre telas** (2026-09-25) — `useScope`.
 - Sem `?periodo=` na URL → último período escolhido na sessão (`sessionStorage` `wedash.period`) → senão **Hoje** (antes: Este mês).
 - Trocar o período numa tela vale para todas (menu não carrega query string).
 - Fechar o app (sessionStorage some) ou fazer logout (`clearSavedPeriod`) → volta para Hoje.

38. ✅ **Destaques da equipe — loja e turno no clique do nome** (2026-09-26) — Visão Geral.
 - Nome da loja saiu da linha; clicar no nome da vendedora abre `Popover` com **Loja(s)** (maior faturamento primeiro, "Também vendeu em…") e **Turno**.
 - `TopSeller.lojas: string[]` sempre preenchido (inclusive com 1 loja no StorePicker).
 - ✅ **Turno real** (2026-09-26): `fetchSellerShifts` (store_seller com `shift_id` → store_shift) → `OverviewAggInput.sellerShifts`. Liga igual ao filtro de gerência: código da funcionária (na loja de maior venda primeiro) → gerador → nome (`name_keys`). Sem ligação = "Sem turno definido". Popover: "Loja" (1) ou "Principal loja" + "Também vendeu em" (várias). Mock removido.
 - **Popover substituído pelo detalhe da pessoa** (2026-09-29): clicar na linha abre o mesmo modal do Dashboard > Equipe (#42), com os dados da Equipe buscados só na 1ª abertura. `TopSeller.key` = mesma chave da tabela da Equipe (`e:{código}` / `n:{nome}`).

39. ✅ **Turnos da loja** (2026-09-26; migration `20260926130000_store_shift`) — Configurações > Lojas > loja.
 - **Na UI, "Turno" virou "Grupo"** (2026-09-30, decisão do dono): Gestão > **Grupos**, coluna Grupo em Colaboradores, filtro "Todos os grupos" e card **Faturamento por grupo** na Equipe, "Sem grupo definido", "Grupos não configurados" (👥). São os mesmos grupos da distribuição da meta. Código, tabela (`store_shift`, `shift_id`) e rotas (`/management/shifts`) seguem com o nome antigo.
 - Card **Turnos** (acima da Equipe de vendas): nome + início/fim (HH:MM local da loja, meia em meia hora, início < fim, sem virar o dia). Salva no botão do card como os demais.
 - Tabela `store_shift` (loja × turno); RLS leitura tenant, escrita OWNER/MANAGER/ADMIN_GLOBAL.
 - **Equipe de vendas** ganhou coluna **Turno** (Select "Sem turno" + turnos da loja) — grava na hora em `store_seller.shift_id`. Excluir turno → vendedoras dele ficam sem turno (FK `on delete set null`). Sync do Millennium não mexe na coluna.

40. ✅ **Carregamento com Skeleton** (2026-09-26) — nada de texto "Carregando…" nas telas do Dashboard e de Configurações. **Cada tela tem o skeleton do próprio layout** (mesmos cards, grades e paddings — nada de formato genérico): `OverviewSkeleton` (StatCards · Atingimento com anel · Faturamento x meta · barras de categoria / dias da semana — some em 1 dia · Ranking de lojas · Formas · Destaques · Top produtos), `FinanceSkeleton`, `ProductsSkeleton` — só na 1ª carga; recargas seguem silenciosas. Configurações: `UsersTableSkeleton` (abas + tabela), `TimelineSkeleton` (Logs), `CardGridSkeleton` (Lojas), `StoreDetailSkeleton` + `TeamTableSkeleton` (detalhe da loja); card Millennium com linha de skeleton. Tudo em `src/components/wedash/LoadingSkeletons.tsx`. Mudou o layout de uma tela → ajustar o skeleton dela junto.
 - **Tempo mínimo do skeleton em todas as telas** (2026-09-28): `useMinSkeleton(loading)` (`src/lib/useMinSkeleton.ts`, `MIN_SKELETON_MS` = 600) — o skeleton fica no mínimo 600 ms desde que a carga começou, para carga rápida não virar um "pisca". Usado em Visão geral, Financeiro, Produtos, Equipe, Gestão / Configurações da operação (`StoreCardsPage`), Administração (Lojas, detalhe da loja, Usuários, Integrações, Logs) e no convite. Tela nova com skeleton → `const showSkeleton = useMinSkeleton(loading)`. Skeleton de dentro do card (turnos / colaboradores de cada loja, depois do skeleton da página) não usa o mínimo.
 - **Voltar para a aba não pisca** (2026-10-02): o supabase-js emite `SIGNED_IN` toda vez que a aba volta a ficar visível; o `SessionProvider` reidratava e criava uma sessão nova (array `stores` novo) → `useScopedStores` e as telas recarregavam com skeleton. Agora sessão igual mantém o mesmo objeto (`keepIfSame`; lojas iguais = mesmo array). **As lojas vêm do banco sem ordem garantida** (`membership_store` / `store`) → comparar sempre pela chave ordenada (`storesKey` em `session.ts`), nunca pela referência ou ordem do array; `useScopedStores` só mostra skeleton quando essa chave muda. Recarga por venda nova (`SALES_SYNCED_EVENT`) é sempre silenciosa — skeleton só na 1ª carga e na troca de filtro (Metas corrigida; Visão geral, Financeiro, Produtos e Equipe já eram assim).
 - **Nº de cards do skeleton = nº de lojas** (2026-09-28): telas com 1 card por loja (Gestão, Configurações da operação) desenham 1 card de skeleton por loja do StorePicker (1 loja = 1 card; "Todas" = lojas da sessão) — `StoreCardsPage` passa a contagem para `skeleton(count)`. Administração > Lojas = lojas da sessão.
 - **Gestão / Configurações da operação sem "pisca" na troca de aba** (2026-09-28): skeleton do card da loja igual ao `StoreCardHeader` (ícone 40px + fantasia + CNPJ, `StoreHeadSkeleton`); Turnos = linhas nome · início – fim · lixeira + "Adicionar turno" + Resetar/Salvar (`ShiftRowsSkeleton`, também dentro do card enquanto os turnos da loja carregam — antes o card ficava vazio); Colaboradores = botão Atualizar + pills + tabela em skeleton enquanto a loja carrega. **Toda entrada na aba mostra o skeleton, por no mínimo 600 ms** — decisão do dono: carga rápida sem tempo mínimo virava um "pisca"; mostrar o último valor na hora e reler em segundo plano foi testado e descartado. `SectionHeader` baixa junto o código das outras abas da seção (sem a tela de carregamento na 1ª troca).
 - **Vazio padrão dos cards** (2026-09-26): `EmptyBlock` (`src/pages/dashboard/`) = `EmptyState` do Vela (padrão "No data yet" / "No results found": emoji num círculo + título + descrição + ação opcional) com `framed={false}` (sem borda tracejada dentro de card), centralizado na horizontal e na vertical. **Dois estados:** sem dados = 📊 "Sem dados no período"; filtro/busca sem resultado = 🔍 + botão outline "Limpar busca/filtros". Botão de **criar** (primary) só onde existe o que criar — ex.: Turnos (🕒 "Adicionar turno"), Usuários/Convites (👤/✉️ "Convidar usuário"), Atingimento da meta sem meta (🎯 "Meta não configurada" + "Criar meta" → tela de Metas; substitui o alerta amarelo e o anel em 0% — é navegação, não CRUD no Dashboard; o card **Faturamento x meta** ao lado mostra o mesmo 🎯 "Meta não configurada" com "Criar meta" (padrão), sem os totais e sem o badge — 2026-09-28), Financeiro > Custos da operação sem nenhum custo preenchido nas lojas do escopo (🧾 "Custos não configurados" + "Configurar custos" → detalhe da loja (abre no topo, sem rolar até o card — decisão do dono) com 1 loja no StorePicker ou usuário de 1 loja; lista de lojas com "Todas"; `FinanceView.custosConfigurados` / `storeOperatingCostsConfigured`); Logs vazio = ✅ + "Tudo certo" + "Nenhum erro ou aviso na sincronização". `DataTable` aceita `empty` (ReactNode) para usar o `EmptyState`; o card é `flex flex-col` para o vazio ocupar a altura da linha (pares ficam alinhados). Tabelas vazias (Top produtos, Top linhas, Desempenho por produto) mostram o bloco no lugar da tabela, sem cabeçalho. Card novo com estado vazio → usar `EmptyBlock`.
 - **Ordenação no celular** (2026-09-29): tabela com cabeçalho ordenável que vira card no celular ganha a linha **"Ordenar por"** no padrão "Sort by" do Data Tables do Vela (`MobileSortBar`, `src/components/wedash/`, só abaixo de `md`, logo abaixo dos filtros): tocar escolhe o campo (ativo na cor primária com ↑/↓), tocar de novo inverte; texto começa A–Z, números começam do maior. Estoque > Produtos: Produto · Estoque · Preço · Lucro. As tabelas do Dashboard (Desempenho por produto, Desempenho da equipe) não usam: são a mesma tabela no celular, com scroll-x.
 - **Paginação das tabelas** (2026-09-26): toda tabela de lista da WDash = **10 por página, no desktop e no celular** (2026-09-28; antes 5 no celular) (`usePagedRows` / `TABLE_PAGE_SIZE` em `src/lib/usePagedRows.ts`). `DataTable` com `paginate="produtos"` (substantivo do rodapé) pagina depois da ordenação e mostra "Mostrando X de Y …" + `Pagination` só quando há mais de 1 página; volta à página 1 ao mudar filtro/busca/ordenação. Aplicado em Configurações (Usuários, Convites, Equipe da loja), Financeiro > Evolução mensal, Metas, ranking da Equipe e Produtos > Desempenho por produto. Top 5 (Top produtos, Top linhas, Destaques) não paginam. Tabela nova de lista → `paginate`.

41. ✅ **Nome de pessoa e de turno em Title Case** (2026-09-26; substitui "tudo em MAIÚSCULAS" do mesmo dia) — padroniza (usuário digita tudo minúsculo, tudo maiúsculo ou misturado). Primeira letra de cada palavra maiúscula; **de · da · do · das · dos · e** minúsculas fora do início ("Ana Paula de Souza e Silva"; "D'Ávila"). Vale para **nome de pessoa** (usuário, equipe de vendas, perfil, boas-vindas) e **nome do turno**.
 - **Colaboradores (equipe vinda do Millennium) = caixa alta em todo o app** (2026-09-29, decisão do dono): `collaboratorName` (`src/lib/format.ts`) na **leitura** — `sellerName` das vendas (`salesRepo`) e `store_seller.name` (`fetchStoreSellers`). Vale para Destaques, Equipe (tabela, pódio, detalhe) e Gestão > Vendedores. O banco segue gravando em Title Case (worker/Edge não mudaram). Usuários do sistema (Gestor/Gerente, perfil, boas-vindas) continuam em Title Case. **Saudação** (2026-10-04): o primeiro nome na tela do vendedor ("Bem-vindo(a) de volta, Emilly") fica em Title Case, igual à Visão geral — só a saudação, as listas seguem em caixa alta. Sem nome: "Bem-vindo(a) de volta 👋". **Card da Início** (2026-10-04): igual à Equipe — abas Ranking · Desafios (os que cruzam o mês, inclusive encerrados) · Metas. Ranking = vendedoras do **grupo da pessoa** no mês (quem ainda não vendeu entra com zero); o nº de vendas do pódio é o real. "Meta não configurada" fica só na aba Metas. **Aba Desafios** (2026-10-05): resultado da própria pessoa, barra e quanto falta (mínimo, lugar acima ou vendas para participar) — a mesma conta do detalhe do desafio; não lista o resultado dos colegas.
 - **Turnos = caixa alta** (2026-09-29, decisão do dono; substitui o Title Case do turno): `shiftName` (`src/lib/format.ts`) ao **gravar** (`saveStoreShift`, Gestão > Turnos) e ao **ler** (`fetchStoreShifts`, `fetchSellerShifts`, Colaboradores) — turnos antigos gravados em Title Case aparecem em caixa alta sem migration. Vale para Gestão (Turnos, Colaboradores), filtro de turno e Faturamento por turno da Equipe e detalhe da pessoa.
 - **Empresa** = **caixa alta** (2026-09-26), igual às lojas: `companyNameCase` (`src/lib/format.ts`) ao gravar (cadastro da conta; a etapa Empresa do onboarding saiu em 2026-09-27) e ao ler (sessão, convite); migration `20260926180000_tenant_name_upper` converteu o que existia. **Loja** = caixa alta (vem assim do ERP, não mexemos).
 - Regra = `titleName` (`src/lib/format.ts`); espelhos: `supabase/functions/_shared/text.ts` (Edges) e SQL da migration `20260926170000_title_case_names`. Mudou a regra → mudar os três.
 - **Gravado já normalizado:** convite (app + Edge `team-members`), turnos (`saveStoreShift`), `seller_name` do worker (`sellerDisplayName`), `store_seller.name` (worker e Edge `erp-sellers-sync`, `millenniumSellers.ts` nas duas cópias). Leitura também passa por `titleName` (rede de segurança).
 - Dados antigos convertidos pela migration `20260926170000_title_case_names` (identity, store_shift, store_seller, sales_seller_day_agg; tenant não). Sem transformação visual no campo enquanto digita (a prop `upper` do `Input` saiu).
 - **Não** vale para e-mail, senha, usuário ERP (diferenciam maiúsculas), busca e números.

40. ✅ **Configurações > Usuários (acesso ao sistema)** (2026-09-26) — `/settings/users`, só **Gestor** (OWNER/ADMIN_GLOBAL) vê e gerencia. Equipe de vendas **não** entra aqui (vem do Millennium; acesso de vendedor = TODO #29).
 - **Papéis simples:** **Gestor** (OWNER — sócio, administrativo, dono) e **Gerente** (MANAGER). Sem Supervisor. Lojas escolhidas no convite, editáveis depois; "Todas as lojas" = `membership_store` vazio = todas, **inclusive lojas novas** (sessão busca as lojas ativas do tenant).
 - **Permissões:** Gestor = tudo das lojas dele. Gerente = Dashboard **sem Financeiro** (Visão geral · Produtos · Equipe) + Gestão (Metas, Desafios, Fechamento, Pedido de compra) + Operação (**Funcionamento**, **Grupos** e **Vendedores**). Custos (Franquia, Aluguel, Produtos e impostos e Adquirentes) = só Gestor. Integrações, Logs, Usuários e Financeiro = só Gestor (`GESTOR_ROLES` / `RequireRole`). Dados no banco seguem RLS por tenant (escopo de loja é da UI).
 - **Convite por e-mail:** Supabase Auth `inviteUserByEmail` (SMTP do projeto) → identity/membership nascem **PENDING** → pessoa abre o link, cria a senha (`/invite/:token`) → `accept` ativa e entra direto. Sem migration (convite = membership PENDING; enviado em / último acesso vêm do Auth).
 - **Tela:** card "Usuários" (subtítulo "Gestores e gerentes que acessam a WDash") + botão **Convidar usuário**; pills (`Segmented`, igual Ativos/Desligados da Equipe — 2026-09-26) **Usuários** (Nome+e-mail · Papel · Lojas · Status Ativo/Suspenso · Último acesso · menu Editar acesso / Suspender / Reativar) e **Convites pendentes** (Enviado há X · Copiar link / Reenviar / Editar acesso / Cancelar convite). Copiar link (2026-10-04) devolve o mesmo link do e-mail (`invite_link_token`), sem gerar outro. Gestor principal (`is_owner`) e o próprio usuário não têm menu. Cancelar convite apaga a conta criada só para ele.
 - **Copy revisada (2026-10-01, spec do dono):** subtítulo da página "Controle quem acessa a WDash e quais lojas cada usuário pode visualizar." · card "Acessos ativos, suspensos e convites pendentes." · **"Papel" virou "Tipo de acesso"** (coluna e campo do modal, obrigatório) · badge **Gestor principal** (sem ícone) + tooltip "Criou a conta da empresa e não pode ter o acesso alterado aqui." · tooltip de "N lojas" separado por " · " · aba Convites = colunas **E-mail** · Tipo de acesso · Lojas · **Enviado em** · editar convite = título "Editar convite · EMAIL" e toast "Convite atualizado." · botões em andamento = "Enviando…" / "Salvando…" / "Suspendendo…" / "Cancelando…" (nunca "Aguarde…") · erros falam do **e-mail** ("Este e-mail já tem…") · `protected_member` vira "O acesso do Gestor principal não pode ser alterado aqui." ou "Seu próprio acesso não pode ser alterado aqui." (a tela escolhe pelo usuário) · "Supabase não configurado" nunca aparece (genérico / "Não foi possível carregar os usuários. Tente novamente."). Vazios seguem com emoji 👤 / ✉️ (padrão `EmptyState`).
 - **Edge `team-members`** (service role): `list · invite · resend · update · suspend · reactivate · revoke` (Gestor) e `invite_info · accept` (pessoa convidada). E-mail já usado em outra empresa → recusa (a sessão só suporta 1 empresa por pessoa).
 - **Config do Supabase (Auth):** **Site URL** = `https://wdash.app` (é o `{{ .SiteURL }}` do e-mail de convite — se ficar `localhost`, o botão aponta para a máquina local). Redirect URLs: `https://wdash.app/**`, `https://wdash.app/invite/**`, `https://wdash.app/invite/link` (e `http://localhost:5173/**` só para desenvolvimento). Template **Invite user** com link `{{ .SiteURL }}/invite/{{ .TokenHash }}`. Validade do link = "Email OTP expiration".
 - **Franqueado novo (2026-10-07):** Authentication → Users → **Invite user** (só e-mail) no painel Supabase. Trigger `provision_franchisee_invite` cria `tenant` + identity/membership `OWNER` (`is_owner`, `onboarding_step = 2`) quando o convite **não** traz `wdash: "member"`. Nome provisório da empresa = parte local do e-mail (caixa alta). Convites da WDash (Usuários / Vendedores) mandam `wdash: "member"` e continuam na mesma empresa.
 - **Apagar usuário no Auth = limpa cascata (2026-10-07):** Auth → `identity` → `membership`. Trigger `delete_orphan_tenant`: se a empresa ficar sem membros, apaga o `tenant` (lojas, ERP, vendas etc. já caem com o tenant). Apagar um Gerente/Gestor que **não** é o último da empresa só remove a pessoa. Cuidado: apagar o **último** usuário de uma empresa real apaga a empresa inteira.
 - Suspender não derruba uma sessão já aberta até o próximo carregamento do app.
 - **Último acesso = uso real do app** (2026-09-26, migration `20260926160000_identity_last_seen`): `identity.last_seen_at`, gravado pela RPC `touch_last_seen()` (no máx. 1x a cada 5 min) que o `AppShell` chama ao abrir, a cada 5 min com a aba visível e ao voltar para o app. A Edge mostra o mais recente entre isso e o último login do Auth (a sessão fica salva por dias, então só o login ficava desatualizado).

42. ✅ **Dashboard > Equipe em dados reais** (2026-09-28) — `buildTeamDashboardView(escopo, aggs)` (`dashboard.ts`); a fixture de metas/escada/desafios saiu da tela (`teamViews.ts` / `blocos.tsx` seguem só para o Ao vivo). **Metas, escada e desafios entram quando os módulos existirem.** Mesmo padrão das demais telas: filtros = Período + **Turno** + Exportar (sem Marca, sem Grupo), "Última atualização", avisos da carga, `TeamSkeleton`, vazio por card, `brlCent`, recarrega com o Atualizar do Topbar.
 - Fonte: `sales_seller_day_agg` (já sem gerência / conta de freelancer, #36) + `sales_day_agg` ALL (faturamento das lojas) + `fetchSellerShifts` (turno). Pessoa = código da funcionária, senão nome (igual Destaques da equipe).
 - **Copy revisada (2026-10-01, spec do dono):** P.A. sem "?" no estado normal (a linha "Itens por venda" já explica; tooltip só quando "—": "O P.A. não está disponível para este período.") · **Faturamento por grupo sem "?"** · tooltip do Desempenho da equipe = "Acompanhe ranking, desafios e metas da equipe no período." (+ frase das vendas fora do ranking) · busca "Buscar por nome…" · Variação do total "Faturamento total das pessoas do filtro em relação ao mês passado." (sem "Cada pessoa pesa…") · pódio "1 venda" no singular e posição vazia "**2º lugar vago**" (neutro) · aba Metas vazia "Cadastre uma meta para acompanhar o desempenho da equipe no período." · tooltip da barra de níveis "N1 · Meta · a partir de 100% da meta · premiação de 1,0%" (também sem os rótulos completos).
 - **Vocabulário único para venda fora do ranking (regra global, 2026-10-01):** texto corrido = "vendas **sem vendedor identificado ou realizadas pela gerência**"; rótulo curto de gráfico = "**SEM VENDEDOR IDENTIFICADO OU GERÊNCIA**" (Composição do faturamento); card da meta = "Inclui R$ X de vendas sem vendedor identificado ou realizadas pela gerência, fora do ranking." Nunca "sem vendedora".
 - **Card da meta (global — aba Metas e detalhe da meta):** selo de prazo "{N} dias restantes" · "Último dia" (diasRestantes conta hoje, então 1 = último dia) · "**Encerrada**" (feminino); selo "Projeção: X%" com tooltip "Projeção de atingimento ao final da meta. Aparece depois de metade do período."; coluna "**Falta para o próximo nível**" (celular "Falta"); último nível = "**Último nível**" (antes "Máximo"); vazio = 👤 "Nenhuma pessoa na meta" / "Nenhuma pessoa da equipe participa desta meta." (sem "competência" nem "elegível"). Nível = "N2 · Super" em todo lugar; Ranking (barra compacta) × aba Metas (tabela detalhada) não é inconsistência.
 - **KPIs:** Faturamento da equipe (sub "N pessoas · média de R$ X"; tooltip: não inclui vendas sem vendedor ou de gerência) · Nº de vendas (sub itens vendidos) · Ticket médio · P.A. ("—" se algum dia com venda não tem itens — nada estimado).
 - **Comparativo sem hora** (não há dado por pessoa/hora): período terminando hoje compara até ontem nos dois lados ("…, até o mesmo dia"); **Hoje = sem badge**. Sem venda no período → sem badge.
 - **Cards:** Faturamento por turno (donut; "Sem turno definido" por último, cinza; sem nenhum turno cadastrado nas lojas → 🕒 "Turnos não configurados" + "Configurar turnos" → Gestão > Turnos, só Gestor/Gerente) · Composição do faturamento (EQUIPE DE VENDAS × SEM VENDEDOR OU GERÊNCIA — rótulos sempre em caixa alta, 2026-09-29) · Desempenho da equipe (tabela: # · Nome [+ loja principal com >1 loja] · Turno · Faturamento · Nº de vendas · Ticket médio · P.A. · Participação · Variação; busca por nome (sem Exportar CSV desde 2026-09-29), Total do filtro (com Variação ponderada, como no Desempenho por produto), paginação "pessoas"). **Mesmo padrão do Desempenho por produto** (2026-09-29): uma tabela só no desktop e no celular (scroll-x; sem cards nem "Ordenar por"), valores em mono negrito, "Mostrando X de Y pessoas" sempre. Linha e pódio abrem o detalhe da pessoa.
 - **Desempenho da equipe com abas** (2026-09-28, igual ao card Desempenho do mês do Ao vivo — `Tabs` accent): **Ranking** = pódio top 3 (`BlocoRanking` do Ao vivo, em `brlCent`) + a tabela acima · **Desafios** = 🔥 "Desafio não configurado" + "Criar desafio" (→ Gestão > Desafios) · **Metas** = **metas reais** (2026-09-30): um `CardMeta` por meta das lojas do StorePicker que cruza o filtro de período (em andamento → a começar → encerradas), igual ao detalhe da meta (`buildGoalCardView`, vendas do início da meta até hoje, não segue o filtro nem o turno); sem meta = 🎯 "Meta não configurada" + "Criar meta". A aba Desafios mostra os desafios em andamento (#49).
 - **Coluna "Nível da meta" no Desempenho da equipe** (2026-09-30; só aparece se alguma meta cruza o período): por pessoa, "82% da meta · N2 · Super" + barra com os cortes e rótulos **"N1 · Meta (1,0%)"** (nome + % de premiação, como na aba Metas) em duas linhas alternadas; a coluna tem largura mínima calculada para os rótulos não se sobreporem (a tabela já rola na lateral). Mesma conta do Destaques (`sellerGoalLevels`, início da meta até hoje). Sem meta = "—". No PDF os rótulos viram só "N1…" para caber. Componente `GoalLevelsBar` (`src/components/wedash/`, `completo` = rótulo com nome e %), também usado no Destaques da equipe.
 - Turno da pessoa = `sellerShiftResolver` (compartilhado com o Destaques da equipe).
 - **Detalhe da pessoa** (2026-09-29, `TeamMemberDetail.tsx` + `buildTeamMemberDetail`): clique na linha/card do Desempenho da equipe (e no Destaques da equipe da Visão geral) = `Modal` com loja · turno · período, Faturamento · Nº de vendas · Ticket médio · P.A. · Itens vendidos · Participação (números = a linha da tabela; participação relativa ao turno filtrado), badges vs período anterior (mesma regra sem hora dos KPIs: Hoje sem badge), faturamento por dia (2–31 dias) ou por mês (> 31; oculto em 1 dia). Sem Vendas por loja (removido 2026-09-29). Ainda sem **produtos da pessoa** (precisa de agregado novo pessoa × produto).
 - **Seção Meta no detalhe da pessoa** (2026-09-30): entre as métricas e o gráfico, só para quem tem meta (mesmo `SellerGoalLevel` da coluna Nível da meta / Destaques — `niveisMeta` do `useTeamMemberDetail`). Cabeçalho "Meta" + nome · datas · "faltam N dias" / "último dia" / encerrada (os números **não seguem o filtro** da tela: início da meta até hoje). Cards **Meta individual** (modo Grupo: Meta do grupo) · **Vendido na meta** (Vendido pelo grupo) · **Premiação até agora** (% do nível sobre as vendas — no Grupo, a parte da pessoa — + bônus somados; tooltip explica). Barra de níveis (`GoalLevelSummary`, com rolagem) e, abaixo de uma divisória, 3 colunas **Próximo nível** (N2 · Super meta) · **Falta vender** (Grupo: "Falta o grupo vender") · **Ao chegar** (2,0% de premiação + R$ Y de bônus na linha de baixo); no celular Próximo nível ocupa a linha inteira e os outros dois ficam lado a lado. No último nível: "Chegou ao último nível da meta." em verde. Meta por grupo ganha nota "o grupo X sobe de nível junto, pela soma das vendas". Sem projeção por pessoa por enquanto. Na Visão geral o mapa vem do `TopSeller.meta` do Top 5.
 - **Filtro de turno** (2026-09-28): ao lado do Período, só aparece se alguma loja do escopo tem turno com pessoa vinculada. Opções = "Todos os turnos" + nomes dos turnos (ordem de início; mesmo nome em lojas diferentes = 1 opção) + "Sem turno definido" (se alguém vendeu sem turno). Filtra KPIs e Desempenho da equipe (participação relativa ao turno); o turno atual da pessoa vale também para o período anterior do badge. Faturamento por turno segue com a equipe toda; Composição vira turno × Demais da equipe × Sem vendedor ou gerência. Estado local da tela (não vai para a URL); turno que some ao trocar de loja volta para "Todos".
43. ✅ **Menu: Gestão + Configurações da operação; Administração no avatar** (2026-09-28) — substitui o item Metas solto e o grupo Configurações do menu lateral.
 - **Nome do grupo = "Configurações"** (2026-09-28, decisão do dono; antes "Configurações da operação") no menu lateral, abas e breadcrumb das telas Custos · Franquia · Aluguel · Produtos e impostos. Rotas `/operation/*` e ícone de Gestão = pessoa com engrenagem (`user-cog`) no mesmo dia.
 - **Menu lateral (Gestor):** Dashboard · **Gestão** (dica "Gerencie metas, desafios, turnos e equipe.": Metas · Desafios · Turnos · Colaboradores) · **Configurações da operação** (dica "Defina os parâmetros usados pela WDash para calcular custos, margens e resultados.": Custos · Franquia · Aluguel · Produtos e impostos). **Copy revisada (2026-09-28):** subtítulos no imperativo ("Configure…", "Gerencie…"), marca no feminino ("A WDash"), erro ao salvar sempre "Não foi possível salvar as alterações. Tente novamente." (`SAVE_ERROR_MSG`, nunca o erro bruto do servidor; mensagens específicas e compreensíveis do Millennium continuam), coluna "Código no Millennium", Desafios sem especificação interna (só o que estará disponível). **Gerente:** Dashboard (sem Financeiro) · Gestão. `NavGroup.description` = `title` do grupo.
 - **"Colaboradores" virou "Vendedores" na UI** (2026-09-30, decisão do dono): menu/aba Gestão > **Vendedores** (subtítulo "Vendedores de cada loja, sincronizados com o Millennium."), toast "Vendedores atualizados.", vazios "Nenhum vendedor ativo/desligado", erros do Atualizar e referências em Grupos e no editor de Metas. Código (`StaffPage`, `paths.management.staff`, `collaboratorName`, `colaboradorId`) e rota `/management/staff` seguem com o nome antigo. Onde este arquivo ainda diz "Colaboradores" = a tela Vendedores.
 - **Instale o app no menu** (2026-10-04, decisão do dono): o card no rodapé do menu lateral vale para **todos os acessos** (Gestor, Gerente e equipe de vendas), enquanto o app não foi marcado como instalado. Equipe de vendas: "Instale o app para receber avisos quando avançar para um novo nível de premiação." Demais: "Instale o app para receber no celular os avisos da WDash." Some com o menu recolhido e depois de "Já instalei".
 - **Ao vivo removido** (2026-10-05; fora do menu desde 2026-09-28): `/live`, `/live/share`, `/live/tv` e as URLs legadas redirecionam para a Visão geral. A tela do vendedor é o Início (`SellerHomePage`). O pódio (`RankingBlock` em `src/pages/live/blocks.tsx`) continua na Equipe e no Início.
 - **Menu do avatar** (2026-09-28, enxugado pelo dono): cabeçalho com foto + nome + e-mail (`Dropdown.header`) · **Meu perfil** · divisória + **Administração** (Integrações · Usuários · Logs — só Gestor) · divisória · **Sair**. Cada item com ícone. Saíram Lojas, Instalar o app e Tema escuro — **Tema escuro** e Instalar o app ficam na tela Meu perfil; **Lojas** saiu também das abas (fica só pela URL `/settings/stores` até voltar com as opções da loja, ex.: forçar atualizar tabelas). Abas de Administração = **Integrações · Usuários · Logs** (mesma ordem do menu, só Gestor), breadcrumb "Administração"; subtítulos no imperativo ("Gerencie a conexão da WDash com o Millennium." · "Gerencie os gestores e gerentes que acessam a WDash." · "Acompanhe os erros e avisos da sincronização com o Millennium.").
 - **Conta (2026-09-30; substitui "Administração")**: menu do avatar = cabeçalho · título **Conta** · Meu perfil · (Gestor) Integrações · Usuários · Logs · divisória · Sair. Mesmo shell (`WedashSettingsLayout`), breadcrumb "Conta", abas **Meu perfil · Integrações · Usuários · Logs** (só Gestor; Gerente vê só Meu perfil, sem abas). URL de Meu perfil segue `/profile` (`/perfil` redireciona).
 - **Meu perfil** (`src/pages/settings/MyProfilePage.tsx`; a página do template em `coming-soon/Profile.tsx` saiu), **layout da aba Profile do `AccountPage` do Vela** (2026-09-30, pedido do dono): grade `lg:grid-cols-[300px_1fr]` — à esquerda card centralizado com a foto 88px + botão "+" (clicar escolhe e **grava na hora**, toast "Foto atualizada."; "Remover foto" abaixo), nome, e-mail e badge do papel (Gestor/Gerente); à direita, empilhados: **Dados pessoais** = Nome · Sobrenome (Title Case, `titleName`) + E-mail (só leitura) + Resetar/Salvar alterações à direita (`saveMyProfile` grava `first_name/last_name/name/avatar_url` na identity e atualiza a sessão) · **Alterar senha** (padrão Security > Change password) = senha atual + nova + confirmação + força da senha; `changeMyPassword` confere a atual com um novo login e troca **sem encerrar a sessão**; senha errada = "Senha atual incorreta." · **Tema** = `Segmented` Claro · Escuro · Automático (`ThemeProvider.preference`, "system" segue `prefers-color-scheme` e troca sozinho; localStorage `vela-theme`). Saíram CPF, Empresa, Lojas, "Sair deste aparelho", "App no celular / Instalar o app" e "Outras franquias".
 - **Meu perfil — copy revisada (2026-10-01, spec do dono):** subtítulo "Gerencie seus dados, sua senha e a aparência da WDash." · card **Aparência** (antes Tema; "Escolha como a WDash aparece neste aparelho. No modo Automático, seguimos a configuração do sistema.") — na UI sempre "Aparência", "tema" só no código · E-mail com ajuda "O e-mail é usado para entrar na WDash e não pode ser alterado aqui." · **Desfazer alterações** (antes Resetar) · senhas uma abaixo da outra · erros: "Não foi possível abrir essa imagem…", "Não foi possível enviar a foto. Tente novamente." (o "ou continue sem foto" só no Crie seu acesso), troca de senha sem "Código inválido…" (vira sessão expirada) e falha genérica "Não foi possível alterar sua senha. Tente novamente.". Badge Gestor/Gerente sem rótulo; quem criou a conta = **"Gestor principal"** igual em Meu perfil, Usuários e avatar do Header (`accessLabel` em `session.ts`, 2026-10-01). **Sessão expirada padrão em toda a WDash: "Sua sessão expirou. Entre novamente."** (`MENSAGEM_SESSAO_EXPIRADA`). **Placeholder da nova senha = regra** ("Use pelo menos 8 caracteres e 1 caractere especial.", `SENHA_REGRA_TEXTO`) em Meu perfil, Crie seu acesso, Convite e Esqueci a senha.
 - **Rotas:** `/management/challenges` e `/goals` (Gestor + Gerente). `/operation/{store,groups,sellers}` (Gestor + Gerente). `/operation/{franchise,rent,products-and-taxes,acquirers}` (só Gestor). `/management/shifts` e `/management/staff` redirecionam para Configurações. `/settings/challenges|staff|costs` e os legados PT redirecionam. StorePicker aparece nessas telas.
 - **Padrão das telas novas** (`src/pages/operation/shared.tsx`: `useScopedStores`, `StoreCardsPage`, `StoreCardHeader`, `SectionHeader`): **abas no topo com as telas do grupo** (padrão Settings do Vela — `TabNav` abaixo do PageHeader; abas = itens do menu, `managementTabs` / `operationTabs` em `nav-wedash.ts`; Metas e Desafios também); **1 card por loja do StorePicker** ("Todas as lojas" = um card para cada), título = loja (fantasia + CNPJ), **Resetar/Salvar por card**. Skeleton `StoreCardsSkeleton`.
 - ~~**Custos**~~ **tela removida (2026-09-28, decisão do dono)**: parecia um DRE — custos fixos, variáveis e outras despesas vão ser configurados na **futura tela de DRE**. Financeiro **parou de usar** esses itens (Resultado operacional = aluguel % + complemento do mínimo + royalties + marketing). Tabela `store_cost_item` e os dados ficam no banco para o DRE; o código da tela e do data layer (`CostsPage`, `fetchStoreCostItems`, `saveStoreCostItems`) saiu e está no git. `/operation/costs` e legados → Franquia. Registro original:
 - **Custos:** 3 listas de itens com nome — **Custos fixos** (R$/mês) · **Custos variáveis** (% do faturamento) · **Outras despesas** (R$/mês); linha = nome + valor + lixeira, "Adicionar". Tabela `store_cost_item` (migration `20260928120000_operation_costs`; kind FIXED/VARIABLE/OTHER, `amount_cents` ou `pct`, `position`; RLS leitura tenant, escrita OWNER/ADMIN_GLOBAL). Lida junto com as lojas (`Store.custoItens`); salvar = `saveStoreCostItems` (apaga removidos, grava o resto).
 - **Franquia:** Royalties e Taxa de marketing WEPINK (+ WPINK se a loja tem a marca). **Copy revisada (2026-10-02, spec do dono):** um texto antes dos campos — "Esses percentuais entram nos custos da operação e são considerados no cálculo do resultado operacional no Financeiro. Campos vazios são considerados 0%." — e os campos agrupados por marca: seção **WEPINK** ("Royalties e taxa de marketing são calculados sobre o faturamento WEPINK.") e seção **WPINK** (só se a loja vende WPINK, texto análogo). Sem ajuda repetida embaixo de cada campo (`CostFieldsCard` aceita `intro` + `sections`; skeleton `StoreCardsSkeleton sections`). Valor inválido (Franquia, Aluguel e Produtos e impostos) = "Confira os valores. Use percentuais entre 0 e 100 e não informe valores negativos." (`INVALID_COSTS_MSG`). **Aluguel — copy revisada (2026-10-02, spec do dono):** subtítulo "Configure o aluguel mensal e, para lojas em shopping, o percentual sobre o faturamento." · texto antes dos campos no padrão da Franquia ("Esses valores entram nos custos da operação… Campos vazios são considerados 0.") · ajuda do Shopping = maior valor entre o aluguel mensal e o percentual, **só o valor excedente** entra nos custos (nunca "aluguel extra" — conversa com a linha "Aluguel percentual excedente" do Financeiro) + exemplo "R$ 12.000,00 de aluguel, sendo R$ 2.000,00 de aluguel percentual excedente" + "No mês em andamento, a comparação considera o aluguel mensal proporcional aos dias já passados." · Loja de rua = "…somente o aluguel mensal." · trocar para Loja de rua com percentual salvo > 0 = aviso inline (sem modal) "O aluguel percentual será removido ao salvar as alterações." Campos seguem **Aluguel** (R$, "Valor mensal.") e **Aluguel percentual** (%, "Percentual sobre o faturamento total."). **Produtos e impostos — copy revisada (2026-10-02, spec do dono):** texto antes dos campos **diferente** de Franquia/Aluguel (os impostos entram antes do lucro bruto): "A tabela de custo ajuda a completar produtos vendidos sem custo no Millennium. ICMS e ICMS ST são considerados no cálculo do lucro bruto e da margem. Campos vazios são considerados 0." · ajuda da tabela "…Enquanto nenhuma tabela for escolhida manualmente, a WDash seleciona automaticamente a que mais se aproxima dos custos da loja." · lista carregando = "Buscando tabelas no Millennium…" (campo desabilitado; antes "Aguardando sincronização") · tabela salva fora da lista = "Tabela {N} · indisponível" · **Impostos por marca (2026-10-05):** ICMS e ICMS ST são separados em WEPINK e WPINK (WPINK só se a loja vende). ICMS sobre o faturamento da marca; ICMS ST sobre o CMV da marca. O percentual único antigo foi copiado para as duas. · ICMS ST = "Percentual sobre o CMV." (CMV é vocabulário oficial). **Sem orientação de preenchimento do ICMS ST** até confirmar se o custo do Millennium já traz o imposto (#21). Erros da busca de preços (`SYNC_PRODUCTS_ERRORS`, também do "Atualizar custos") no padrão Conta › Integrações: "Verifique os dados da integração em Conta › Integrações." · "Acesse Conta › Integrações para conectar novamente." · "Os custos já estão sendo atualizados…" · "Esta tabela de custo não está mais disponível. Atualize os cadastros em Conta › Integrações e escolha outra tabela." · falha genérica "Não foi possível buscar as tabelas de custo. Tente novamente." (o Atualizar cadastros da própria tela de Integrações mantém textos sem apontar para ela). **Aluguel (registro anterior):** Aluguel mínimo (R$/mês, `store.rent_min_cents` — renomeado de `rent_fixed_cents`, que nunca foi preenchido) + Aluguel percentual. Subtítulo: "O WDash considera o maior valor entre o aluguel mínimo e o percentual do faturamento." **Produtos e impostos:** Tabela de custo dos produtos + ICMS + ICMS ST (regras do #32 e #24b).
 - **Gestão > Grupos — copy revisada (2026-10-02, spec do dono):** vazio "Crie os grupos da loja para organizar os vendedores e acompanhar o desempenho por grupo." · placeholder "Nome do grupo" (sem exemplo) · ajuda acima da lista "Defina o horário em que cada grupo atua. Ele aparece junto ao grupo nas análises da equipe." (é verdade: rótulo "MANHÃ · 09:00–15:00" no Desempenho da equipe, detalhe da pessoa e Vendedores; o horário não decide quais vendas são do grupo) · seletores com rótulo acessível Início / Fim. **Excluir grupo com vendedores pede confirmação** (Modal "Excluir grupo {NOME}?" · "3 vendedores ficarão sem grupo definido." / "1 vendedor ficará sem grupo definido." · Cancelar / Excluir grupo); conta só a equipe de vendas ativa ligada ao grupo salvo; grupo sem vendedor ou ainda não salvo sai direto. A confirmação só tira a linha — a exclusão acontece no Salvar alterações; até lá o card mostra "{NOME} será excluído ao salvar as alterações." e o Resetar desfaz. Rodapé segue Resetar / Salvar alterações (padrão de Configurações).
 - **Gestão > Vendedores — copy revisada (2026-10-02, spec do dono):** subtítulo "Acompanhe os vendedores de cada loja e defina seus grupos." · botão **Atualizar vendedores** (em andamento "Atualizando…"; tooltip "Busca no Millennium os vendedores desta loja.") — diferente do Atualizar do Header, que busca vendas · rodapé "Mostrando X de Y **vendedores**" (em Gestão = nome do objeto administrado; "pessoas" fica no Dashboard > Equipe) · vazios separados: loja sem ninguém sincronizado = 👥 "Nenhum vendedor sincronizado" / "Busque no Millennium os vendedores desta loja." + Atualizar vendedores; só desligados = "Nenhum vendedor ativo" / "Não há vendedores ativos nesta loja no momento." (sem botão); Desligados vazio sem mudança · seletor de grupo desabilitado enquanto grava · erros no padrão das outras telas: "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente." · "A conexão com o Millennium ainda não foi configurada. Acesse Conta › Integrações para conectar." · "Não foi possível acessar o Millennium. Verifique os dados da integração em Conta › Integrações." · "A conexão com o Millennium está desconectada. Acesse Conta › Integrações para conectar novamente." · sessão em outro local (mesmo texto de Integrações/Estoque) · "Você não tem permissão para atualizar os vendedores." · **Convidar só com grupo** (2026-10-04): sem grupo vinculado o botão fica desabilitado ("Vincule um grupo antes de convidar.") e a Edge recusa o convite — ranking e meta da tela Início dependem do grupo.
 - **Gestão > Turnos** (antes card do detalhe da loja, #39) e **Gestão > Colaboradores** (antes card Equipe, #29: Atualizar do Millennium, Ativos/Desligados, coluna Turno). **Metas e Desafios em branco** (2026-09-28, decisão do dono: telas a desenhar) — só cabeçalho + abas da Gestão (`GoalsPage`, `ChallengesPage`); a listagem fixture de Metas saiu. Detalhe da loja (Administração > Lojas) = **só Funcionamento**.
 - **Financeiro (Resultado operacional):** aluguel do mês por loja = **maior entre o mínimo e o %** → linha "Complemento do aluguel mínimo" = max(0, mínimo − aluguel %), calculado por **loja × mês** (mínimo rateado pelos dias do recorte; mês parcial = mínimo proporcional). No gráfico por dia o complemento do mês é dividido igualmente pelos dias; por hora, complemento + fixos + outras despesas são rateados nas horas abertas. Custos fixos e outras despesas = R$/mês ÷ dias do mês por dia; custos variáveis = % × faturamento. Linhas (só se > 0): Aluguel percentual · Complemento do aluguel mínimo · Royalties/Marketing · Custos fixos · Custos variáveis · Outras despesas. **Aluguel exibido como fixo + excedente** (2026-09-28, decisão do dono; mesmo total = maior entre os dois): tela Aluguel = **Tipo de loja: Shopping · Loja de rua** (`Segmented`, com a regra e o exemplo no texto de ajuda do Shopping; copy revisada pelo dono 2026-09-28 — vazio "Nenhuma loja disponível", nunca "escopo" na UI; coluna `store.point_type` MALL/STREET, migration `20260928130000_store_point_type`; null = Shopping — não dá para saber pelo ERP) + **Aluguel** (R$/mês, `rent_min_cents`) + **Aluguel percentual** (só em Shopping; escolher Rua oculta o campo, grava o % como vazio e o Financeiro ignora qualquer % de loja de rua); subtítulo com o exemplo "aluguel de R$ 10.000 e 10% sobre R$ 120.000 vendidos = R$ 2.000 a mais". Card Custos da operação: linha **Aluguel** (fixo rateado nos dias do recorte) + **Aluguel percentual excedente (10%)** = max(0, % × faturamento − aluguel), por loja × mês, só quando > 0; loja só com % = linha "Aluguel percentual" com o valor inteiro. Mês em andamento compara o % do faturamento até agora com o aluguel proporcional aos dias. "Configurar custos" (vazio) → Configurações > Franquia (desde a remoção da tela Custos; custos fixos/variáveis/outras despesas fora do cálculo até o DRE).
44. ✅ **Atualizar cadastros do Millennium** (2026-09-28) — botão **"Atualizar"** (primary) no card Millennium de Integrações, ao lado do "Configurar" (conectado, só Gestor/OWNER; antes ficava dentro do modal), sem tooltip. **Só o que é leve e da rede do usuário** (decisão do dono, 2026-09-28): **lojas** + **opções de tabela de custo** do ERP (~2s).
 - **Fora do botão:** produtos e categorias (catálogo compartilhado entre todas as redes — recarrega sozinho quando alguma loja vende produto desconhecido, #32/#34); **preços** das tabelas de custo (vêm com essa recarga automática e quando o usuário troca a tabela da loja); **colaboradores** (vendedor novo nas vendas = sync automático da equipe da loja, #29/#33; situação e cargo = botão Atualizar de Gestão > Colaboradores).
 - **Síncrono, sem fila** (2026-09-28): Edge `erp-products-sync` com `scope: "registry"` (lista de tabelas de custo + lojas, 2 chamadas, sem lease; sessão salva, 401 → login com a senha cifrada) → ~2s e funciona com o worker parado. Pela fila levava 3–8s (worker olha a fila a cada 5s). `refreshErpRegistry` (`erp.ts`) → toast "Cadastros atualizados." ou erro. O job `REGISTRY` do worker (migration `20260928140000_sync_job_registry`, `action: "registry"` na `erp-sync-enqueue`) fica no código, sem uso pela UI.
 - O job (`runRegistryJob`): **lojas** (`FILIAIS.Lista` → atualiza código, nome, fantasia, CNPJ e inauguração das lojas que já existem; **loja nova no ERP não entra** — segue pela reconexão) · **gerador** de todas as lojas · **lista de tabelas de custo** (lookup `tabela_custo.TABELA`, 1 chamada, sem preços). Cada parte é independente: falhou uma → as outras seguem e o job termina FAILED com "não atualizou: …". Sessão caiu (401) → derruba o job; senha recusada → credencial INVALID.
45. ✅ **Exportar = PDF pelo layout de impressão** (2026-09-28, decisão do dono: "layout de impressão próprio") — botão **Exportar** da Visão geral, Financeiro, Produtos e Equipe abre a janela de impressão do navegador com o relatório da tela; o usuário escolhe "Salvar como PDF". Sem lib de PDF.
 - `src/lib/printMode.ts`: `exportPdf(partes)` liga o modo de impressão (tema **claro** forçado durante a impressão, volta ao tema do usuário no `afterprint`) e troca o título da aba = nome do arquivo sugerido: "WDash - {Tela} - {Loja ou Todas as lojas} - {Turno, na Equipe} - {Período}". **Loja = código da filial + fantasia** (2026-09-29, ex.: "00010 SB EMPREENDIMENTOS" — a fantasia do ERP nem sempre identifica a filial); usuário com 1 loja só sai com a loja dele (não "Todas as lojas"). Cabeçalho do PDF: "Loja: FANTASIA · Filial 00010 · CNPJ". `installPrintMode` (AppShell) faz o Ctrl+P usar o mesmo layout.
 - **Papel:** A4 deitado, margem 10 mm (~1047px úteis → grades de desktop `lg` valem). Some: menu lateral, Topbar, breadcrumb, filtros/Exportar/"Vendas de hoje atualizadas…" do cabeçalho, busca e paginação das tabelas, botões dos estados vazios, ícones "?" das dicas, sombras. Card não quebra no meio (`print:break-inside-avoid`); tabela longa repete o cabeçalho a cada página. **Tabelas cabem na largura** (2026-09-29, `index.css` @media print): sem rolagem lateral nem largura mínima (`min-w-[…]` das tabelas e das células zerados), fonte menor (10,5px; textos secundários 9px), padding lateral 5px e texto quebrando linha (sem `truncate`) — antes as tabelas de 520–900px eram cortadas nas laterais, principalmente nos cards de meia largura. **Reforço (2026-09-29):** o contêiner do app (`AppShell`, `overflow-x-hidden`) ganhou `print:overflow-visible` (cortava o que passasse da folha); na impressão tudo na célula quebra linha (números só no espaço, `font-mono`) e o avatar das tabelas some (`.vela-avatar`). Testado com Chrome headless em A4 deitado: tabela de 12 colunas cabe em 1047px. Tooltip não existe no papel → informação que só está no tooltip vai escrita com `hidden print:block` (ex.: transferência no Estoque). Atenção: `.cursor-help.rounded-full` = ícone "?" e some na impressão — não usar essa combinação em conteúdo.
 - **Cabeçalho do PDF** (`ReportHeader`, `src/pages/dashboard/`, só no papel): marca WDash · "Gerado em DD/MM/AAAA HH:MM" · "Vendas de hoje atualizadas às…" · **Loja** (fantasia + CNPJ ou "Todas as lojas") · **Período** ("Este mês · 01/09/2026 a 28/09/2026") · filtros da tela (Equipe: Turno). Título da Visão geral no papel = "Visão geral" (sem a saudação).
 - **Tabelas saem completas** (todas as linhas do filtro/busca/ordenação atual, sem paginação): `usePagedRows` e a paginação manual de Produtos/Equipe leem `usePrintMode()`. Equipe imprime o conteúdo do Ranking (pódio + tabela) sem as abas.
 - Tela nova com Exportar → `useExportPdf("Tela")` + `<ReportHeader />` antes do `PageHeader` + `print:p-0` no container.
46. ✅ **Estoque** (refinado e implementado 2026-09-29; nasceu como tela única "Produtos") — grupo **Estoque** no menu (ícone de caixa, entre Dashboard e Gestão) = **Estoque** (`/stock/inventory`) · **Pedido de compra** (`/stock/purchase-order`, `PurchaseOrderPage`, **em branco** até ser desenhada — só cabeçalho; ver #47). Sem abas no topo. Gestor **e** Gerente. (No mesmo dia o grupo chegou a sair e Estoque virou item solto; voltou com o Pedido de compra — decisão do dono: telas separadas, ligadas pelo saldo.)
 - **Tabelas de venda excluída e grupo Estoque removido** (2026-09-29, decisão do dono): `/stock/sale-tables` redireciona para Estoque; a tela Estoque não carrega mais preços, tabelas de venda nem vendas dos últimos 30 dias (`useStockData` = catálogo + estoque). O que ficou pronto e sem uso na UI: `stockProducts.ts` (conta de lucro por peça / preço mínimo, com teste), leitura de preços em `stockRepo.ts`, partes `saleTables`/`salePriceTableIds` da Edge `erp-stock-sync`, tabelas `product_sale_table`/`product_sale_price` e `sales_price_table_day_agg` (o worker segue gravando a tabela usada em cada venda, sem chamada extra). O texto abaixo sobre Tabelas de venda fica como registro.
 - Registro original: grupo **Estoque** no menu, entre Dashboard e Gestão (depois entram Previsão de estoque etc.). Uso: ver quanto custa e quanto sobra de cada produto (inclusive para as meninas montarem kits — **simulador de kit = fase 2**).
 - **Lista de produtos compartilhada** (catálogo, #34); por loja mudam estoque, custo (tabela de custo da loja), impostos e custos variáveis.
 - **Conta por peça:** custo de aquisição = custo + ICMS ST (% do custo); despesas sobre a venda = ICMS + royalties + marketing (da marca do produto) + aluguel % (+ % da meta quando existir) × preço; **lucro por peça** = preço − despesas − custo de aquisição; **preço mínimo** = custo de aquisição ÷ (1 − Σ%).
 - **Tabela de venda = seletor só nesta tela** (decisão do dono): não é configuração da loja — a loja muda de tabela todo dia (+10, +14, +20…); a ideia é simular "quanto sai o produto com a tabela X" e ver qual vale mais a pena. Opções = lookup `tabela_venda.TABELA` (16 tabelas; sem INDEFINIDO). Preço = wtsreports `{24B9BF6D-E463-4ED9-B74E-DF3AF5E1E02F}` (`TABELA_DE_CUSTO` + `TABELA_DE_VENDA` + `PRODUTO_DIVISAO_DIVISAO: null`, raw, ~3,5s, 471 produtos): `F_3554079995` = preço de venda, `F_3294710456` = custo (bate 100% com a tabela de custo gravada), `PRODUTO_PRODUTO_BLOQUEIA_VENDA`.
 - **Preço médio praticado (últimos 30 dias)** = coluna ao lado do preço da tabela, com a margem nesse preço — vem de `sales_product_day_agg` (sem chamada ao ERP). Motivo: > 50% dos itens saem abaixo do preço da tabela (desconto/promo).
 - **Estoque = saldo da loja somando todos os locais** (corrigido 2026-09-29): `FRANQUIAS.RELATORIOS.ESTOQUEPORLOCAL` com `FILIAL` = id da loja no ERP (1 chamada por loja, ~0,1s): `SALDO` por `COD_PRODUTO` × `LOCAL`; total = soma dos locais (bate 100% com o `SALDO` do `ESTOQUEEMCOMPRA` nas 4 lojas). Saldo por local gravado em `store_stock.locations` (jsonb; migration `20260929130000_store_stock_locations`, que também zerou `stock_synced_at` para descartar o estoque antigo só do QUIOSQUE).
 - **Transferência entre locais** (2026-09-29, pedido do dono): local negativo + outro local positivo na mesma loja = transferência pendente (`stockTransfers`: qtd = mín(negativo, soma dos positivos)). Ex.: Óleo Booster Repair na 00010 = ESTOQUE 144 · QUIOSQUE −71 → "Transferir 71 do ESTOQUE para o QUIOSQUE". Na lista (2026-09-29, substitui o fundo amarelo da linha): **pendências como badges abaixo do nome do produto** — "Estoque negativo" (vermelho) · "Transferir N" (amarelo) · "Sem custo" / "Sem preço" (neutros; "Sem custo" some quando nenhuma loja do filtro tem tabela de custo, porque o aviso do topo já explica) — cada um com tooltip da instrução (no celular a instrução aparece em texto); a linha ganha só uma **marca na borda esquerda** (vermelha se negativo, amarela se transferência). **Nomes dos locais em Title Case** na leitura (`stockRepo`, via `titleName`: "Estoque", "Quiosque", "Shop010"; o banco guarda como vem do ERP). **Cada local de estoque vira uma coluna própria** (2026-09-29, substitui o saldo por local abaixo do total): Estoque · Quiosque · demais em ordem alfabética (ex.: Shop010) · **Total**, todas ordenáveis; com várias lojas, cada coluna soma o mesmo local nas lojas do filtro. Só aparecem quando existe mais de um local com saldo no filtro (loja só com QUIOSQUE = uma coluna "Estoque"). Local negativo em vermelho, zero em cinza. No celular, os locais entram na grade do card antes do Total. Layout da tela: ver "Implementado" abaixo (padrão Data Tables, sem card; substituiu o card "Custo e lucro por produto" com barra de filtros e chips). Celular = card por produto com grade de 2 colunas (Estoque · Preço de custo · Preço de venda · Lucro por peça · Margem). Os avisos "N produtos precisam de transferência entre locais de estoque" e "N produtos estão com estoque negativo" são **só informativos, sem link** — os produtos ficam nas pills da própria tabela (2026-09-29; "Ver produtos" e a lista expansível saíram). Estoque negativo = alguma loja do filtro com total < 0. Detalhe do produto: seção "Estoque por local" por loja com a instrução. A loja tem vários locais de estoque no Millennium (`ESTOQUEPORLOCAL`: **ESTOQUE**, **QUIOSQUE**, **SHOP010**…) — a entrada cai em ESTOQUE e a venda sai do QUIOSQUE, então cada local sozinho fica errado (negativo) e **só a soma é real**. A 1ª versão usava o `{9701602B}` com o gerador, que traz **só o QUIOSQUE** (00010: 171 peças × 5.248 reais; `FTWINC-ATH-001` 12 × 109 = 89 ESTOQUE + 12 QUIOSQUE + 8 SHOP010; 00205: 636 × 5.740). 00114 e 00386 só têm QUIOSQUE (iguais). **Mostra o número do ERP como está** + aviso com os produtos de estoque negativo (depois da correção: 00010 = 29, 00205 = 4 — nota de entrada pendente).
 - **"Todas as lojas"**: estoque somado; custo e margem por loja no detalhe do produto.
 - Tabela usada em cada venda existe no relatório de cupom `{52DE7BBC}` (`VENDA_TABELA_PRECO_TABELA` / `_DESCRICAO`; ex.: 00010 = 20201 ≈75% · 20305 ≈25%) — serve para sugerir a tabela padrão do seletor.
 - **Tabela padrão do seletor = a mais usada (em peças) nos últimos 30 dias** das lojas do filtro (2026-09-29; antes o último dia com venda); o usuário troca à vontade (estado da tela, não vai para a URL). **Detalhe do produto compara as tabelas usadas nos últimos 30 dias** (preço · lucro por peça · margem na loja escolhida). Últimos 30 dias carregados uma vez por script (29/09): SITE ADICIONAL 20 ≫ 10 > 8 > LIVE > 12/14; 00386 sem venda.
 - **Implementado:**
 - **Separado em duas telas** (2026-09-29, decisão do dono: estoque e tabela de venda são perguntas diferentes; substitui a tela única `/stock/products`, que redireciona para Estoque). Menu Estoque = **Estoque** (`/stock/inventory`, `InventoryPage`) · **Tabelas de venda** (`/stock/sale-tables`, `SaleTablesPage`) — **sem abas no topo** das telas (troca só pelo menu lateral); dados em `useStockData({ prices })` (Estoque só busca o estoque no Millennium; Tabelas de venda só a lista de tabelas e os preços), peças comuns em `src/pages/stock/shared.tsx`. As duas **idênticas ao `DataTablePage` do Vela, sem card**: filtros no `PageHeader` no padrão da Visão geral (`HeaderFilters`: um abaixo do outro no celular com o Exportar por último, em linha no desktop; **filtros no padrão do Dashboard** (2026-09-29: `HeaderFilter` + `HeaderSearch` em `src/pages/dashboard/HeaderFilter.tsx` — gatilho igual ao do período, 40px, opção atual + seta, menu com a opção marcada; busca na mesma altura; **filtros sem ícones em todas as telas** (2026-09-29), **exceto o seletor de período**, que voltou a ter o ícone de calendário antes do valor, na cor primária com o calendário aberto (2026-09-30; mesmo padrão do `DatePicker` de data única); o filtro de Turno da Equipe usa o mesmo componente), `Button` secondary "Exportar"), linha "Estoque/Preços atualizados às…" logo abaixo dos filtros, avisos (`PageHeader notices`: no celular entre o título e os filtros; no desktop abaixo do cabeçalho), **"Ordenar por"** acima da tabela também no computador (`MobileSortBar always`; cabeçalho da tabela não ordena), `DataTable` do Vela (**mesmas colunas no celular e no desktop**, com rolagem lateral — 2026-09-29; antes escondia colunas por `hideBelow`; sem card por produto) e rodapé "Mostrando X de Y produtos" + paginação fora da tabela.
 - **Copy revisada (2026-10-01, spec do dono):** dentro da tela o processo se chama **buscar estoque** (Atualizar continua sendo só o botão global do Header) — horário "Buscando estoque…" / "Estoque atualizado às HH:MM" / "em DD/MM às HH:MM" / "ainda não atualizado"; tooltip "O estoque é buscado no Millennium ao abrir esta tela, quando a última busca tem mais de 30 minutos, e quando você usa Atualizar." (não existe busca periódica) · status **"Ok" virou "Regular"** · o QUIOSQUE do Millennium aparece como **"PONTO DE VENDA"** (antes "LOJA" — "loja" na WDash é a filial; `STOCK_SALES_LOCATION` em `stockProducts.ts`): "Transferir 71 de ESTOQUE para PONTO DE VENDA." · título do aviso sem ponto final ("N produtos estão com estoque negativo no Millennium") · 1ª busca "Buscando estoque" / "Buscando os saldos no Millennium…" · vazio **"Nenhum saldo encontrado"** (antes "Sem estoque", parecia ruptura) · mensagens: parcial "Não foi possível buscar todo o estoque. Alguns valores podem estar desatualizados.", geral "Não foi possível buscar o estoque no Millennium. Tente novamente.", sem permissão "Você não tem permissão para buscar o estoque.", desconectada (fallback) "A conexão com o Millennium está desconectada." · mensagem da tabela de custo removida (Estoque não depende dela) · **integração desconectada ou senha inválida = não inicia a busca** (nem ao abrir, nem com Atualizar; `fetchErpConnection`, mesmo cache do aviso) — só o aviso fixo, sem toast · PDF "WDash - Estoque - {LOJA ou Todas as lojas} - {DD-MM-AAAA}" (tela sem período leva a data em que foi gerado) · Pedido de compra: "Prepare o pedido de compra de cada loja.".
 - **A receber (2026-10-08):** a coluna **A receber** soma os pedidos em aberto do Saldo Atual e Futuro (`store_purchase_stock`, o mesmo dado do Pedido de compra), por código, nas lojas do filtro. **Total geral** = saldo em estoque + a receber. Produto sem saldo que só tem pedido também entra. Sem busca do saldo futuro, as duas células ficam "—". A tela busca o saldo futuro junto com o estoque quando a última busca tem mais de 30 min. O **Valor** continua sendo só o saldo que já está na loja.
 - **Preço de custo e marca (2026-10-08):** duas colunas, alinhadas à direita como o saldo. **Preço de custo** = preço unitário da tabela de custo da loja; "Varia" quando o preço não é o mesmo nas lojas do filtro. **Valor** = saldo × esse preço; o total do filtro soma o Valor. Sem custo, a célula fica "—". Filtro **Marca** (Todas as marcas · WEPINK · WPINK) só quando alguma loja do escopo tem WPINK, pela mesma regra do Dashboard (código `WP*` = WPINK).
 - **Lista no padrão do Desempenho por produto** (2026-10-01, decisão do dono: tudo que é lista de produto usa o mesmo componente; substitui o `DataTable` sem card + "Ordenar por" descritos abaixo): card **Produtos** com tabela própria — # · Produto (`ProductNameCell`: avatar com iniciais coloridas + nome + "código · categoria") · um local por coluna · Total · A receber · Total geral · Preço de custo · Valor · Status por último. Produto ocupa o espaço que sobra; as colunas de número ficam na largura do conteúdo, com respiro entre Valor e Status; **cabeçalhos ordenam** (inclusive cada local; texto começa A–Z, números e Status do maior para o menor) · números em mono negrito (negativo vermelho, zero cinza) · linha **Total do filtro** (soma das peças por local e no total, de todos os produtos do filtro) · rodapé "Mostrando X de Y produtos" + paginação dentro do card · mesma tabela no celular com rolagem lateral (sem "Ordenar por"). Filtros seguem no cabeçalho da página; linhas sem clique (Estoque não tem detalhe). Peças compartilhadas: `src/components/wedash/ProductNameCell.tsx` (Top produtos e Desempenho por produto em Produtos, Top linhas, Top produtos da Visão geral, listas do detalhe do produto e Estoque) e `InitialsAvatar.tsx` (`AvatarIniciais`, também usado na tabela da Equipe). Skeleton = mesmo card (`StockProductsSkeleton` → `TopTableSkeleton`). **Nome do produto e categoria em caixa alta** (2026-10-01, decisão do dono: igual às demais telas; substitui o Title Case via `labelCase` do Estoque — `fetchStockCatalog` em `stockRepo.ts`; o filtro Categorias também sai em caixa alta).
 - **Estoque:** Buscar · **Status** (Todos os status · Negativo (N) · Ok (N), só os que têm N > 0) · Categorias · Exportar. Tabela no **modelo do `DataTablePage` do Vela** (2026-09-29, decisão do dono), a mesma no celular e no desktop (rolagem lateral; sem card): Produto (avatar + nome + código · categoria) · um local por coluna (sempre que houver local; com 1 local só, a coluna tem o nome dele e não há Total) · Total · **Status por último** — números em mono à direita. Locais por loja no ERP (29/09): 00010 = Estoque · Quiosque · Shop010; 00205 = Estoque · Quiosque; 00114 e 00386 = só Quiosque. **Sem a quantidade vendida nos últimos 30 dias.** **Status padronizados (2026-09-29, decisão do dono), o mais grave primeiro, avaliado por loja do filtro: "Negativo" (vermelho = total da loja abaixo de zero) · "Aguardando transferência" (amarelo = algum local negativo com saldo positivo num local "pai"; se o total da loja ficar negativo, vale Negativo). **Hierarquia dos locais** (decisão do dono): **Estoque** é pai de todos · os demais (Shop010…) são filhos do Estoque · a **Loja** é filha de todos. Ou seja: Loja negativa + qualquer outro local positivo, ou local intermediário negativo + Estoque positivo. Estoque negativo não tem pai → não gera Aguardando. **Tooltip no badge Aguardando** (toque no celular) = "Transferir 71 de ESTOQUE para LOJA.", uma linha por origem ("{LOJA}: transferir …" quando há várias; copy revisada pelo dono 2026-09-29 — busca "Buscar por produto ou código…", vazio "Buscando estoque" durante a 1ª busca, "Limpar filtros" na busca sem resultado; PDF "Lojas: Todas as lojas" e "Gerado em DD/MM/AAAA às HH:MM" em todos os relatórios); **no PDF a mesma instrução sai escrita abaixo do badge** — `stockTransfers` segue a hierarquia: cobre primeiro os locais intermediários (só pelo Estoque) e depois a Loja (pelo que sobrar, do local com mais saldo) · "Ok" (verde)**, badge com texto fixo, sem número e sem texto abaixo. **Nomes dos locais sempre em caixa alta e QUIOSQUE do ERP aparece como "LOJA"** (ESTOQUE · SHOP010 · LOJA; mapeado na leitura, `stockRepo`; o banco guarda como vem). Ordem das colunas = hierarquia: Estoque · demais (Shop010…) · Loja. Saíram "Transferir N" e "Em falta" (e o aviso de transferência, a linha "Transferir N do X para o Y" e os produtos sem saldo que só venderam — `includeSold`). Local negativo continua em vermelho na coluna do local. `stockTransfers` alimenta o status Aguardando e o tooltip. Ordenar por **Produto · Total · Status** (loja com 1 local só: a opção leva o nome dele, sem caixa alta, ex.: "Loja") (2026-09-29; um por local foi testado e ficou opção demais) (Status do mais grave para o mais leve: Negativo → Aguardando → Ok). **Sem detalhe do produto** (2026-09-29, decisão do dono): tudo fica na própria linha.
 - **Tabelas de venda:** Buscar · **Tabela de venda** (padrão = mais usada nos últimos 30 dias) · Categorias · Exportar. Só produtos com preço na tabela. Colunas Produto (+ "Sem custo" / "Média das lojas") · Preço de custo · Preço de venda · Lucro por peça · Margem · Preço mínimo. Ordenar por Produto · Preço · Lucro · Margem. Clique = modal com composição do preço, por loja, tabelas usadas em 30 dias e preço praticado. Aviso de loja sem tabela de custo.
 - *(Histórico da tela única, antes da separação:)* Tela **no padrão Data Tables do Vela, sem card** (2026-09-29): cabeçalho com Buscar · Tabela de venda · Status · Categorias · Exportar. PDF sem período (cabeçalho mostra a tabela e o horário do estoque). **Nomes de produto, categoria e tabela de venda em Title Case** na leitura (`labelCase` em `format.ts`: sigla sem vogal fica maiúscula — "Desod Col VF Golden 100ml", "WP Ultra"; loja segue em caixa alta). **Só a listagem, sem KPIs** (decisão do dono 2026-09-29: não é tela de Dashboard); colunas **Produto · Estoque · Preço de custo · Preço de venda · Lucro por peça (+ margem)** na tabela escolhida; "média das lojas" quando o custo varia entre lojas; card por produto no celular; 10 por página. Impostos, franquia/aluguel, custo total, preço mínimo, preço praticado e comparação entre tabelas ficam só no **detalhe do produto** (clique = `Modal` com por loja e a conta linha a linha). `StockProductsSkeleton`.
 - Conta pura em `src/data/wedash/stockProducts.ts` (+ teste); leitura em `stockRepo.ts`.
 - Banco (migration `20260929120000_stock_products`): `product_sale_table` + `product_sale_price` (globais, como as tabelas de custo) · `store_stock` (loja × código; quantidade do ERP) + `store.stock_synced_at` · `sales_price_table_day_agg` (loja × dia × tabela: peças e R$).
 - **Busca no Millennium sob demanda** (Edge `erp-stock-sync`, síncrona, Gestor e Gerente — gerente só nas lojas dele): ao abrir a tela busca o que está velho — lista de tabelas de venda (> 1 dia), preços da tabela escolhida e das usadas em 30 dias (não buscados hoje), estoque das lojas (> 30 min). O **Atualizar do Topbar** com a tela aberta força estoque + lista + preços da tabela escolhida (`FORCE_REFRESH_CLICK_EVENT`, #31). Trocar para uma tabela sem preço de hoje busca só ela. Reusa a sessão salva; 401 → login com a senha cifrada.
 - Worker: o relatório de cupom (que já roda no Atualizar, fechamento e carga) grava a tabela usada em `sales_price_table_day_agg` — **nenhuma chamada nova ao ERP**.
47. ✅ **Pedido de compra — campos do cadastro de produto** (anotado 2026-09-29; **cadastro implementado no mesmo dia**; tela de Pedido de compra = #50) — `product_catalog.registered_at` (date) · `purchase_multiple` (int) · `purchase_blocked` (bool) (migration `20260929140000_product_catalog_registry` + RPC `set_product_catalog_registry`, só atualiza produto que já está no catálogo). Worker: `fetchProductRegistry` (`millenniumCatalog.ts`) roda **dentro da recarga de produtos** (`refreshProducts`, +1 chamada, qualquer loja — o cadastro é igual em todas; medido 581 códigos × 4 lojas = 0 diferenças); falhou = WARN "Cadastro dos produtos (Saldo Atual e Futuro)" em Logs, a recarga segue. `DATA_CADASTRO` vem à meia-noite de Brasília em UTC → data com −3h. Carga inicial (29/09): 579/580 preenchidos · 88 bloqueados · múltipla mais comum 24 (351) e 12 (136), 32 sem múltipla · 2 cadastrados em set/26. Campos da API: `COD_PRODUTO · DESCRICAO1 · SALDO · BLOQUEADO_COMPRA · TAMANHO · ESTAMPA · COR · QUANTIDADE_MULTIPLA · DESC_COR · QUANTIDADE_PEDIDO · TOTAL · QUANTIDADE_FATURADA · DATA_CADASTRO` (linha por tamanho/cor; ~600 linhas por loja). Registro original: quando formos fazer a tela de **Pedido de compra**, o catálogo (`product_catalog`, compartilhado) precisa de **Quantidade múltipla** (pedido em múltiplos de N; ex.: 12 ou 24), **Bloqueado compra** e **Data de cadastro** (produto cadastrado no mesmo mês do pedido = **produto novo**). Fonte: relatório **Saldo Atual e Futuro** do Millennium = `MILLENIUM!FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA` (body `{ FILIAL, DESC: null, TIPO: null, DATAI: null, DATAF: null }`; colunas na tela do ERP: Data Cadastro · Cod Produto · Descrição · Bloqueado Compra · Tamanho · Cor · Estampa · Quantidade Vendida · Saldo · Quantidade Pedido · Total · Quantidade Múltipla). Decisão do dono: usar **só para o cadastro dos produtos**; o estoque da loja continua no `ESTOQUEPORLOCAL` (#46). Nomes exatos dos campos na API a confirmar na implementação.
 - **Direção para a tela de Pedido de compra** (combinado com o dono 2026-09-29, a implementar junto com a tela): **abrir a tela = só o nosso banco, zero chamada ao ERP**. Botão **Atualizar** da tela = `ESTOQUEEMCOMPRA` **1 chamada por loja do pedido** (~0,5s; a 1ª após o login ~5s) → atualiza no catálogo descrição · data de cadastro · múltipla · bloqueado e traz da loja saldo · quantidade pedida · quantidade faturada. **Só se vier código que não está no catálogo** → recarrega **tipos + produtos** (~20 chamadas, ~4s) para pegar categoria e id do ERP (o relatório não traz nenhum dos dois; não existe consulta de 1 produto com tipo). Recarga de produtos já separada da recarga de preços de custo (#32, "Recarga separada por gatilho") — o Pedido de compra chama só `refreshCatalog` para os códigos novos. Opcional: marcar produto do catálogo que sumiu do relatório como "fora do Millennium".
48. 🟡 **Gestão > Metas — criar / editar** (2026-09-30; tela `GoalEditorPage`, gravação ligada) — tabela `goal` (migration `20260930120000_goal`, aplicada): loja × período sem sobreposição (constraint `goal_no_overlap` → "Já existe uma meta desta loja nesse período."), `target_cents`, `tier_mode`, `tiers` (`[{name,minPct,commissionPct,bonusCents}]`) e `groups` (`[{shiftId,name,pct}]`, soma 100). `saveGoal` (`goalsRepo.ts`) cria/atualiza; salvou → toast e abre o detalhe da meta.
 - **Duplicar meta** (2026-10-02, decisão do dono: a meta do mês seguinte costuma ser a mesma configuração com outro valor; **outra loja 2026-10-07**): ícone **Duplicar meta** no card e botão no detalhe abrem modal com duas opções. **Próximo período** → `/goals/new?copy=ID` (`paths.goalCopy`): avança datas (`nextGoalPeriod`), nome (`copyGoalName`), meta da loja vazia + "Meta anterior: R$ X", mesma loja (ou filtro do topo). **Outra loja** (só com 2+ lojas) → `/goals/new?copy=ID&for=store` (`paths.goalCopyStore`): **mesmas datas e nome**, meta da loja **preenchida**, combo liberado (origem fora da lista; "Escolha a filial de destino."). Nada é gravado até "Criar meta". Copia modo, níveis, gerência e % dos grupos (casado por id/nome na loja nova). Abaixo do título: "Cópia de {NOME}" / "… · mesma configuração para outra loja".
 - **Combo Loja sempre visível, bloqueado quando a loja já está definida** (2026-10-02, decisão do dono; substitui "o campo some e a loja vai abaixo do título" do mesmo dia; vale para Metas e Desafios): "Todas as lojas" no StorePicker = combo liberado para escolher. Uma loja no StorePicker, usuário de 1 loja ou **editando** (a loja não muda depois de criada — os grupos são da loja) = combo **bloqueado** com a loja; ajuda "Para escolher outra loja, selecione Todas as lojas no topo." / "A loja não pode ser alterada depois que a meta/o desafio é criado(a)." A linha "Loja: …" abaixo do título saiu (fica só "Cópia de …"). Trocar a loja no StorePicker durante a criação troca a loja.
 - **Obrigatórios (* vermelho):** Nome · Data início · Data fim · Loja · Meta global (sempre R$, sem "Tipo de meta") · Modo de premiação (padrão Individual). Erro = campo em vermelho + mensagem embaixo + toast "Revise os campos destacados." (nada é gravado). Erros aparecem só depois da 1ª tentativa de salvar e somem conforme o campo é corrigido.
 - **Grupos de distribuição** (chave no cabeçalho do card): grupos da loja (Gestão > Grupos), só o % muda; digitar num grupo distribui o resto automaticamente; a soma precisa fechar **exatamente 100%**. Pessoa sem grupo = só aviso.
 - **"→ Cada pessoa: R$ X (N pessoas na equipe)"** abaixo da Meta global só aparece no modo **Individual sem grupos de distribuição** (2026-09-30) — com grupos a meta de cada um vem do % do grupo; no modo Grupo a meta não é dividida por pessoa. O aviso "Nenhuma pessoa na equipe de vendas desta loja" continua em qualquer caso.
 - **Alerta da Premiação progressiva segue o modo** (2026-09-30): Individual = % sobre a meta individual (meta do grupo ÷ pessoas do grupo, ou meta global ÷ equipe sem grupos), premiação sobre o que a pessoa vende · Grupo com grupos = % sobre a meta de cada grupo, premiação do grupo dividida igualmente · Grupo sem grupos = a equipe toda sobe junto, premiação dividida entre todos. Bônus sempre por pessoa.
 - **Premiação progressiva** (chave no cabeçalho; antes "Comissão progressiva"): níveis com **Meta %** (obrigatório, crescente entre níveis) · **Premiação %** (obrigatório; % sobre **tudo o que for vendido**, "a partir de", sem teto) · **Bônus R$** (opcional, fixo por atingir o nível). Sempre sobre o total vendido (sem "Comissão sobre" / excedente). **Bônus somam** (decisão do dono): bateu o 2º nível = bônus do 1º + do 2º (editor mostra "+R$ X · total R$ Y").
 - **Modo de premiação:** Individual = cada pessoa sobe de nível pela própria meta (meta do grupo ÷ pessoas) e ganha sobre as próprias vendas; bônus individual. Grupo = o grupo sobe junto pela soma das vendas; a premiação é dividida igualmente entre as pessoas do grupo e o bônus vale para cada uma. **Geral** (2026-10-08) = a loja sobe junta pelo **total vendido** (o mesmo realizado da meta da loja, inclusive venda sem vendedor); a premiação desse total é dividida igualmente entre as pessoas da equipe e o bônus vale para cada uma. Sem grupos de distribuição (o card some) e sem meta individual. `tier_mode = GENERAL`.
 - **Simulação** com Premiação progressiva ligada **e** (Grupos de distribuição ligados **ou** modo Grupo). Modo Grupo sem grupos (2026-09-30) = meta coletiva: a simulação mostra um bloco só, "Equipe toda", com a meta global, a premiação de cada nível e "R$ X cada" (dividida pela equipe de vendas ativa). Premiação do pódio fora da criação da meta por enquanto.
 - **Listagem** (`GoalsPage`, 2026-09-30, padrão Roles do Vela, `sm:grid-cols-2 xl:grid-cols-3`): metas das lojas do StorePicker cujo período cruza o filtro de período (calendário até 12 meses à frente). Card = ícone alvo + nome + período (+ loja com >1 loja) + badge Em andamento / A começar / Encerrada · Meta da loja · realizado + % + barra · rodapé (projeção só após 50% do período · faltam N dias / Começa em… / Fechou no nível X) · chips Individual|Grupo · N níveis · N na equipe · avatares da equipe ativa + lixeira (Modal "Excluir meta?") · **Editar** · **Ver detalhe**. Ordem: em andamento → a começar → encerradas. Vazio = 🎯 "Nenhuma meta no período" + "Criar meta". `GoalCardsSkeleton`. Equipe ainda não usa a meta real (Visão geral usa — ver abaixo).
 - **Card no formato do Categories do Vela** (2026-10-02, decisão do dono; substitui o card acima — `ProductCategories.tsx` do template): card inteiro clicável = abre o detalhe (sem botão "Ver detalhe"; Enter/espaço pelo teclado) · topo = ícone alvo 50px (hero) + nome + "período · loja" + botões quadrados de **duplicar** e **excluir** (ícone, 28px, com tooltip; excluir abre o mesmo Modal "Excluir meta?"; **sem editar no card** — 2026-10-02, decisão do dono: editar fica no detalhe da meta) · linha de valor = realizado em verde mono à esquerda e "82,0% de R$ 15.000,00" à direita (a começar: meta da loja + "Meta da loja") · barra de 5px · rodapé (projeção · faltam N dias / Começa em… / Fechou no N2 · Super) · badges **Status** (Em andamento / A começar / Encerrada) · Individual|Grupo · N níveis · N na equipe + avatares da equipe à direita. `GoalCardsSkeleton` no mesmo formato.
 - **Tela de detalhe** (`/goals/:id`, `GoalDetailPage`): Voltar + breadcrumb, nome + status + período · loja, "Editar meta", e o **mesmo `CardMeta` da Equipe** com dados reais (realizado = `sales_day_agg` ALL da loja no período; pessoas = equipe de vendas ativa ∪ quem vendeu; projeção linear pelos dias). `CardMeta`/`FaixaMetaGlobal` ganharam `hojeIso` (antes só o relógio da fixture); badge de grupos some com 0.
 - **Detalhe da meta no layout do Project Details do Vela** (2026-10-01, decisão do dono; substitui o `CardMeta` único): barra = Voltar + breadcrumb + **Compartilhar** (outline; **só o botão por enquanto** — toast "O compartilhamento com a equipe estará disponível em breve."; a ideia futura é a equipe de vendas ver níveis e premiação da meta do mês) + **Editar meta**. **Resumo** (card com ícone alvo + nome + status + "datas · loja") e linha de números: Meta da loja · Realizado · Atingimento · **Premiação até agora** (Σ premiação + bônus já garantidos pela equipe, com "?") · Dias restantes / Prazo ("Último dia" · "Encerrada" · "Começa em DD/MM"). **Coluna esquerda:** Progresso da meta (`FaixaMetaGlobal semProjecao`: barra com os níveis, sem o selo de projeção) · **Níveis e premiação** (formato da lista de Milestones: "N1 · Meta", "A partir de X% da meta · Bônus R$ Y (total R$ Z) · N de M pessoas", % de premiação à direita; check verde quando alguém da meta já chegou ao nível; "?" explica o modo Individual/Grupo) · **Equipe na meta** (`CardVendedoras` com `title`/`help`/`aside`, mesma tabela de antes). **Coluna direita (320px):** **Atingimento da meta** (mesmo formato da Visão geral: anel + Realizado · Meta · Faltam · Projeção; projeção = ritmo linear × meta, só depois de metade do período — antes "Aparece depois de metade do período"; encerrada "Meta encerrada"; a começar "A meta ainda não começou") · Detalhes (Início · Fim · Loja · Modo de premiação · Níveis · Pessoas na meta · Grupos de distribuição) · Grupos de distribuição (só com grupos: nome · % · R$). `GoalDetailSkeleton` no mesmo layout.
 - **Premiação da gerência** (2026-10-02, decisão do dono; **no mesmo nível 2026-10-05**): chave **Premiação da gerência** no card Níveis de premiação (desligada por padrão). Ligada, cada nível da equipe ganha o bloco **Gerência** (Premiação % + Bônus R$ opcional), na mesma linha do vendedor. A prévia do nível mostra o mesmo formato do vendedor ("a partir de R$ X na meta da loja · premiação de Y%"), sem o valor em reais. Na Simulação, o bloco **Gerência** repete os níveis sobre a venda da loja, com o R$ e a soma dos bônus. O percentual incide sobre a **venda da loja** (sem teto). **Uma regra só por meta, sem pessoa** ("Gerência"; gerente + subgerente não são separados — o cargo GERENCIA do Millennium não identifica a pessoa: a conta genérica NORTE.SUL também tem). Regra: mesmos cortes de % dos níveis, contra a **meta global** e o **faturamento total da loja** (inclui vendas sem vendedor identificado ou realizadas pela gerência); premiação = % do nível alcançado × tudo o que a loja vendeu (sem teto); bônus dos níveis alcançados se somam. Gravado no jsonb `goal.tiers` (`managerCommissionPct`, `managerBonusCents`; sem migration). Conta em `goalManagerPrize` (`goalView.ts`, com teste). Detalhe da meta: linha "Gerência X% + R$ Y (total R$ Z)" em cada nível, card **Premiação da gerência** na coluna direita (Nível atual · Premiação até agora · Falta para o próximo nível), "Premiação até agora" do resumo soma equipe + gerência, Detalhes "Premiação da gerência: Sim/Não". **Não vai no futuro Compartilhar** (a equipe vê só a premiação dela).
 - **Fechamento da premiação** (2026-10-02, pedido do dono: "quando a meta estiver encerrada, ver o resumo de quanto cada vendedor e a gerência vão receber"): card logo abaixo do resumo, **só com a meta encerrada**. Copy do ponto de vista de quem **ganhou** ("Quanto cada pessoa e a gerência ganharam com a meta.", **Total ganho**) — nunca "a pagar" (decisão do dono). Resumo Equipe · Gerência (se configurada) · **Total ganho**; tabela Nome (+ grupo) · Nível ("N2 · Super" / "Abaixo do 1º nível") · Faturamento · Premiação (+ %) · Bônus · Total ganho, pessoas do maior total para o menor, linha **GERÊNCIA** por último (faturamento = total da loja) e linha Total; quem está sem meta (fora dos grupos) não entra. Valores com centavos (`brlCent`). Selo **Em fechamento** (amarelo) até o dia seguinte ao fim — o último dia fecha na madrugada e ainda pode mudar; depois disso, sem selo (o "Valores finais" verde saiu a pedido do dono, 2026-10-02). Nota no modo Grupo (premiação do grupo dividida igualmente). **Exportar** = PDF só com o resumo + o fechamento (cabeçalho próprio: marca · gerado em · loja · meta · período), arquivo "WDash - Fechamento da meta - LOJA - META - período". Com a meta encerrada: "Premiação até agora" vira **Premiação total** (resumo e card da gerência), some o "Falta para o próximo nível" (card da gerência e coluna da tabela Equipe na meta, prop `encerrada` do `CardVendedoras`). Coluna Premiação da Equipe na meta passa a usar centavos e ordena por premiação + bônus.
 - **Detalhe da meta simplificado** (2026-10-02, decisão do dono: "muitos cards, muita informação"; substitui as duas colunas do layout Project Details acima) — **uma coluna, 3 cards, nenhum número repetido**:
 1. **Resumo**: nome + status + "datas · loja · Premiação individual/por grupo" (com "?" do modo) e os números Meta da loja · Realizado (+ "X% da meta") · **Faltam** (encerrada sem bater = "Faltou"; bateu = "Meta atingida") · **Projeção** (só em andamento; "—" + "Disponível após metade do período" antes disso) · Premiação até agora / total · Prazo.
 2. **Níveis e premiação**: a barra de progresso com os níveis (`FaixaMetaGlobal soBarra` — só a barra, sem repetir realizado/%/dias), a linha **Grupos** (nome · % · R$, só com grupos), a lista de níveis e, em andamento com premiação da gerência, a faixa **Gerência** (nível atual · R$ até agora · falta para o próximo nível).
 3. **Equipe na meta** (em andamento / a começar) — com a meta **encerrada** dá lugar ao **Fechamento da premiação**, que vem logo depois do resumo (o card de níveis fica abaixo dele e não sai no PDF).
 Saíram os cards Atingimento da meta (anel), Premiação da gerência, Detalhes e Grupos de distribuição. `GoalDetailSkeleton` no mesmo formato.
 - **Trocar a loja no topo sai do detalhe** (2026-10-05): detalhe e edição de meta (e de desafio) voltam para a lista quando a loja escolhida não é a do registro. "Todas as lojas" permanece na tela. `useReturnWhenStoreChanges`.
 - **Copy das Metas revisada (2026-10-02, spec do dono)** — listagem, detalhe e criar/editar:
 - **"Meta da loja" é o termo oficial do valor total em toda a WDash** (nunca "meta global" — soa como meta da rede inteira). Os cards do editor viraram **Distribuição por grupos** e **Níveis de premiação** (antes Grupos de distribuição / Premiação progressiva); labels "Data de início" / "Data de fim"; split "Meta individual: R$ X · N pessoas na equipe".
 - **Prazo** (`prazoRestante` em `goalView.ts`, listagem e detalhe): "{N} dias restantes" · "Último dia" (os dias contam hoje, então "1 dia restante" nunca aparece) · "Encerrada" · "Começa em DD/MM". Rodapé do card da listagem: "Projeção: X% · 12 dias restantes" (sem projeção, só o prazo) · "Começa em DD/MM/AAAA" · encerrada "Nível final: N2 · Super" / "Nenhum nível atingido".
 - **Compartilhar escondido** no detalhe até a funcionalidade existir (antes era botão com toast "em breve").
 - Projeção = **estimativa** ("Disponível após metade do período"). Linha do nível: "A partir de X% da meta · bônus de R$ · bônus acumulado de R$ · N de M pessoas" + linha "Gerência: X% · bônus de R$ · total de R$". Fechamento: badge **"Fechamento em andamento"**.
 - **Colunas da Equipe na meta seguem o modo** (`CardVendedoras grupo`, também no `CardMeta` da Equipe): Individual = "Meta individual" / "% da meta individual"; Grupo = "Meta do grupo" / "% da meta do grupo" (no modo Grupo a linha já mostra a meta e o % do grupo). Premiação: "2,0% · +R$ X de bônus".
 - Editor: resumo do nível = "A partir de R$ X na meta da loja · premiação de X% · bônus de R$" (a soma "total de R$" ficou só na Simulação; o R$ da premiação também); ajuda dos níveis em 4 linhas (Meta · Premiação · Bônus · bônus acumulados); Simulação desligada = 🧮 "Simulação indisponível"; blocos "{GRUPO} · X%" com "R$ por pessoa" e "bônus de R$ por pessoa".
 - **Estados da Simulação, nesta ordem** (2026-10-02): sem loja = 🏬 "Selecione a loja" · sem meta da loja = 🧮 "Falta a meta da loja" · grupos/equipe carregando = skeleton · loja sem grupos (com Distribuição por grupos ligada) = 🧮 "Nenhum grupo cadastrado" · falta % de grupo ou nível = 🧮 "Faltam dados" (todos os vazios com 🧮, nunca 💡). Bloco de grupo sem ninguém = aviso "Nenhuma pessoa neste grupo." (equipe toda: "Nenhuma pessoa na equipe de vendas desta loja."). A prévia dentro de Distribuição por grupos mostra "R$ por pessoa" **só no modo Individual** (no Grupo a meta não é dividida).
 - **Detalhe da meta** (`buildGoalCardView`) segue as mesmas regras: meta do grupo = meta × % (sem grupos = a meta inteira para a equipe toda); pessoa ligada ao grupo pelo `store_seller.shift_id`; quem não está em nenhum grupo da meta fica sem meta ("—"). Individual = meta do grupo ÷ pessoas, premiação sobre as próprias vendas; Grupo = sobe pela soma do grupo, premiação dividida igualmente. Bônus somado dos níveis alcançados.
 - **Visão geral usa a meta real** (2026-09-30; sai a fixture `goalOfStore` na versão com dados reais): **Atingimento da meta = período fechado da meta** (decisão do dono, 2026-09-30; a versão "proporcional ao filtro" do mesmo dia foi descartada — abrir em Hoje e ver ~0% não ajuda): soma das metas **inteiras** que cruzam o filtro (ex.: 01/09 a 30/09; filtro com 2 meses = as duas metas) × vendido **do início de cada meta até hoje**, qualquer que seja o filtro. "Todas" = soma das lojas com meta; subtítulo = nome + datas (1 meta) · "Soma de N metas" · "Soma das metas de N lojas" · "**2 de 4 lojas com meta**" quando falta meta em alguma loja. % sem teto (anel para em 100%). Projeção por meta = ritmo dos dias fechados × meta (pesos por dia da semana), só depois de metade da meta esperada ter passado; todas encerradas = "Meta encerrada". O dia contra a meta do dia fica no **Faturamento x meta** (esse segue o filtro). **Faturamento x meta** distribui a meta pelos dias **dela** (`periodDailyGoal`, pesos por dia da semana do histórico) e depois por hora. Equipe segue sem meta.
 - **Nível de meta no Destaques da equipe** (2026-09-30): cada pessoa do Top 5 mostra, abaixo de vendas · ticket · P.A., **o mesmo bloco da coluna "Nível da meta" do Desempenho da equipe** (`GoalLevelSummary`): "82% da meta · N2 · Super" + barra com os cortes dos níveis **fora de escala** ("simulação do progresso", decisão do dono: cada trecho 0→N1, N1→N2… tem só o espaço do nome do nível; o preenchimento anda proporcional dentro do trecho — 110% com N1 = 100% e N2 = 120% fica no meio entre N1 e N2; o último nível fecha a barra) e rótulos completos "N1 · Meta (1,0%)" no corte, **todos na mesma linha, qualquer que seja a quantidade de níveis** (decisão do dono): a barra reserva a largura em que os rótulos cabem lado a lado e, quando o card é mais estreito (celular e desktop), **rola na lateral** (`rolagem`). Na tabela da Equipe (coluna "Nível da meta") vale o mesmo — a largura fica na célula e a própria tabela rola. Sem badge de nível (o "Abaixo do 1º nível" ficava ruim no celular). Mesma conta do detalhe da meta (`sellerGoalLevels` → `buildGoalCardView`: grupo, modo Individual/Grupo), do **início da meta até hoje** (igual ao Atingimento, não segue o filtro). Pessoa sem meta (fora dos grupos da meta, ou loja sem meta) = sem badge. Várias metas = a que começou por último. A Visão geral busca também vendas por pessoa e a equipe das lojas com meta.
49. 🟡 **Gestão > Desafios** (2026-10-02; **implementado local, sem commit** — falta `db push` da migration `20261002120000_challenge`, rodar o worker novo e validar com o dono) — desafios curtos para a equipe (em geral 4 por mês, 1 por semana), com prêmio em R$ ou em espécie ("Combo KFC"). Mesmo padrão de Metas: listagem em cards, editor, detalhe, fechamento.
 - **Tabela `challenge`** (molde da `goal`, **sem trava de período**: dois desafios da mesma loja podem cruzar e cada um é calculado sozinho): loja × período · `metric` (PRODUCTS · CATEGORIES · PA · TICKET) · `mode` (CONTEST = Disputa · MINIMUM = Mínimo) · `products` (código + nome salvo — produto que sai do catálogo continua com nome) · `categories` (tipo do catálogo) · `target` (Mínimo = alvo; Disputa = piso opcional; itens inteiro, P.A. 2 casas, ticket em centavos) · `min_sales` (P.A./ticket) · `prizes` (Disputa 1º–3º; Mínimo 1 por pessoa) · `manager_prize`. Prêmio = `{kind: MONEY, amount}` ou `{kind: ITEM, label}` (até 60 caracteres). RLS leitura tenant, escrita Gestor/Gerente.
 - **Dado novo, sem chamada nova ao ERP:** `sales_seller_product_day_agg` (loja × dia × gerador da pessoa × `COD_PRODUTO`: itens e R$), gravado pelo worker a partir do mesmo relatório Produtos por Cupom do Atualizar / madrugada / carga do histórico. Falhou → WARN "Itens por pessoa" em Logs e o job segue. **Desafios são daqui para frente**: só tem esse dado o que o worker novo gravar (a carga do histórico recarregando um mês também preenche).
 - **Participantes** = equipe de vendas ativa da loja (cargo VENDEDOR) ∪ quem vendeu na loja no período (desligada que vendeu continua, o gestor decide). Vendas sem vendedor identificado e da gerência ficam fora; só a loja do desafio.
 - **Configuração simplificada** (2026-10-02, decisão do dono: "o desafio é mais simples de configurar que uma meta"; substitui Métrica Produtos/Categorias/P.A./Ticket e os modos Disputa/Mínimo na UI). Editor = **3 cards em 3 colunas** no desktop (2026-10-02, decisão do dono; 1 coluna no celular): **Informações gerais** (nome · datas · loja) · **Tipo de desafio** (tipo + o que conta + produtos/categorias — coluna quase só para os produtos, que podem ser muitos; produtos = **campo fechado que abre o Searchable select do Vela** (2026-10-02, decisão do dono; substitui a lista sempre aberta e o multi-select com tags que fechava a cada escolha): campo mostra "Selecione os produtos" / "N produtos escolhidos" + seta; clicar abre o painel (busca com foco · pills **Todos N / Escolhidos N** · **Selecionar todos (N) / Desmarcar todos** quando há busca ou em Escolhidos · lista com checkbox, linhas compactas sem avatar — nome com o trecho buscado na cor primária + código · categoria · rodapé "N escolhidos" + Limpar + **Concluir**). O painel fica aberto enquanto marca; fecha no clique fora, Esc ou Concluir (a busca zera ao fechar). Teclado: ↑/↓ navega, Enter marca. Escolhidos viram tags com × abaixo do campo (12 visíveis + "+N" / "Mostrar menos")) · **Premiação** (quem ganha · mínimo · vendas mínimas · prêmios · prêmio da gerência). Ordem dos campos: nome · datas · loja → **Tipo de desafio** (Quantidade · Valor · P.A. · Ticket médio) → **O que conta** (só Quantidade/Valor: **Produtos · Categorias**; "Tudo o que vender" saiu da tela em 2026-10-02 — decisão do dono, não seria usado; o cálculo e o banco ainda aceitam `ALL`, e editar um desafio antigo assim abre em Produtos) → **Quem ganha** (**Quem fizer mais** = pódio · **Quem chegar ao mínimo** = todos que chegarem) + o mínimo com o nome do tipo (**Quantidade mínima** em itens inteiros · **Valor mínimo** R$ · **P.A. mínimo** 2 casas · **Ticket médio mínimo** R$; obrigatório em "Quem chegar ao mínimo", opcional em "Quem fizer mais" = abaixo dele não leva prêmio mesmo em 1º) + **Vendas mínimas para participar** (P.A./ticket/índice; **opcional** desde 2026-10-07 — vazio = sem piso; se preenchido, inteiro ≥ 1; sugestão 10 ao trocar o tipo) → prêmios → prêmio da gerência. Banco: migration `20261002130000_challenge_type_scope` (`metric` QUANTITY · VALUE · PA · TICKET + coluna `scope` PRODUCTS · CATEGORIES · ALL; desafios antigos PRODUCTS/CATEGORIES viram Quantidade com o mesmo escopo; a leitura aceita o formato antigo). Códigos `CONTEST`/`MINIMUM` seguem no banco.
 - **Resultado:** Quantidade = itens dos produtos/categorias escolhidos (`sales_seller_product_day_agg`) ou, em Tudo, itens das vendas da pessoa (`sales_seller_day_agg`) · Valor = R$ dos produtos/categorias escolhidos ou, em Tudo, faturamento da pessoa · P.A. = itens ÷ vendas · Ticket = faturamento ÷ vendas. Categoria = tipo do catálogo (na leitura). Resultado que depende de itens com algum dia de venda sem itens = "—" e não vence (nada estimado). Aviso "Resultado incompleto" só quando conta produtos/categorias escolhidos.
 - **Disputa:** ranking do maior para o menor, empate compartilha a posição (1, 1, 3) e leva o prêmio dela; vence a posição N ≤ nº de prêmios quem tem resultado > 0, ≥ piso e (P.A./ticket) vendas ≥ mínimo — quem está abaixo do mínimo de vendas não entra no ranking (não tira o prêmio de ninguém). **Mínimo:** todo mundo com resultado ≥ alvo (e vendas ≥ mínimo) "Atingiu" e ganha o prêmio. **P.A.** (2026-10-08): o número aparece durante o desafio, mas ninguém (nem a gerência) fica "Atingiu" antes do fim — o P.A. tem que se manter, e a conta que vale é a do encerramento. Enquanto está aberto e a pessoa já está no mínimo: "O P.A. só vale no fim do desafio".
 - **Gerência** (opcional): ganha se a **média da equipe** chegar à **Meta da gerência** — campo próprio e obrigatório com a chave ligada, independente do alvo/piso das vendedoras (2026-10-02, decisão do dono: o piso da Disputa é baixo de propósito e amarrar a gerência a ele deixava fácil demais). Ao ligar, vem preenchida com o alvo/piso, editável; Disputa sem piso também pode ter gerência. Média: Quantidade/Valor = Σ resultados ÷ participantes (inclui quem vendeu zero) · P.A. = Σ itens ÷ Σ vendas · ticket = Σ R$ ÷ Σ vendas (conta do time inteiro, não média das médias). Gravada em `manager_prize.target` (sem migration; desafio antigo sem ela usa o alvo/piso). Detalhe: "Média da equipe" × "Meta da gerência".
 - **Telas:** `/management/challenges` (cards no formato das Metas: líder(es) ou "N pessoas atingiram", prêmio principal, prazo, Duplicar/Excluir) · `/management/challenges/new` (+ `?copy=ID` = dia seguinte ao fim, mesma duração, "(cópia)"; `?copy=ID&for=store` = mesmas datas/nome para outra loja, 2026-10-07 — mesmo modal de Metas) · `/:id/edit` · `/:id` (resumo · alerta amarelo "Resultado incompleto" com os dias da loja com venda sem itens por pessoa · Participantes com posição, resultado, o que falta e prêmio · faixa da Gerência). **Encerrado** = card **Fechamento do desafio** (vencedores, colocação, prêmio; total em R$ só dos prêmios em dinheiro; em espécie listados pelo nome; "Nenhum vencedor neste desafio."; selo "Fechamento em andamento" até o dia seguinte ao fim) + **Exportar** PDF só com resumo e fechamento. Status no masculino: Em andamento · A começar · **Encerrado**.
 - **Copy revisada (2026-10-02, spec do dono) — vocabulário igual ao do Dashboard:** tipos **Itens vendidos · Faturamento · P.A. · Ticket médio** (antes Quantidade / Valor; códigos QUANTITY/VALUE seguem no banco) · **Quem atingir o mínimo** (antes "Quem chegar ao mínimo"; conversa com Atingiu/Atingiram) · tipo de prêmio **Valor em R$ · Outro prêmio** (texto livre) · fechamento **Outros prêmios** (antes "Prêmios em espécie", soava como dinheiro). Critério: "Mais itens vendidos" · "Maior faturamento" · "Maior P.A." · "Maior ticket médio" (+ " · mínimo de X") · "Mínimo de X". Destaque do card: frase completa sem rótulo quando não há resultado ("Ainda não há líder", "Nenhum vencedor", "Ninguém atingiu (ainda)", "1 pessoa atingiu · mínimo de X"); prêmio principal "1º lugar: X". Situação sempre diz para quê: "… para o mínimo" / "… para o 2º lugar" / "Faltam N vendas para participar"; ticket "Faltam R$ X de ticket médio…". Ajuda do Ticket médio sem fórmula (fórmula só na Meta da gerência). Itens no resumo "A · B · +2". **"ao menos" → "pelo menos" em toda a WDash.**
 - **Índice de desempenho** (2026-10-02, decisão do dono; substitui a fórmula da planilha `=(E3/100*40)+(D3/11087,1*35)+(B3/130*25)`, que usava referências fixas e misturava ticket com faturamento): 5º tipo, código `INDEX` (migration `20261002140000_challenge_index`). **Índice = 100 × (0,50 × faturamento ÷ faturamento médio + 0,25 × ticket ÷ média dos tickets + 0,25 × P.A. ÷ média dos P.A.s)** — pesos **fixos** (`INDEX_WEIGHTS`, sem campo na tela). Base = **média simples dos valores individuais de quem vendeu no período** (`indexTeamBase`; não o ticket/P.A. consolidado da equipe, onde quem vende mais pesa mais) → a média dos índices de quem vendeu é exatamente 100. Exibido com 1 casa, sem % nem "pontos". **Quem fizer mais** ou **Quem atingir o mínimo** (2026-10-07), escopo Tudo. **Prêmio da gerência = índice da equipe × período anterior** (2026-10-02, decisão do dono; substitui no mesmo dia "N pessoas no índice mínimo" — a média da equipe no desafio é sempre 100, então não serve de meta): mesma fórmula, com as médias da equipe no desafio ÷ as médias da equipe no **mesmo nº de dias logo antes do desafio** (`teamIndex` + `managerIndexWindows`). 100 = igual ao período anterior; 105 = 5% melhor. Um campo só, **Índice mínimo da gerência** (sem pré-preenchimento). Em andamento os dois lados vão **até ontem** (sem dia parcial; 1º dia do desafio = "—"); sem venda num dos lados ou dia sem itens = "—" (nada estimado). Busca das vendas por pessoa começa no período anterior só para esse caso. Gravado em `manager_prize.target` (sem migration). Detalhe: "Índice da equipe" (+ "?" com as datas do período anterior) × "Meta da gerência"; Prêmios "· índice da equipe de 105,0". "Índice mínimo" (piso opcional) e "Vendas mínimas para participar" valem. Alguém que vendeu com dia sem itens = "—" para todos (nada estimado; tooltip "Índice indisponível porque faltam dados de itens em pelo menos um dia com vendas."). Copy (spec do dono): ajuda do tipo "Combina faturamento (50%), ticket médio (25%) e P.A. (25%), comparando o resultado de cada pessoa com a média da equipe. Índice 100 representa a média; 120 representa 20% acima." · Quem ganha "Ganha quem tiver o maior índice…" · situação "Faltam 3,2 pontos para o 2º lugar" / "Falta 1,0 ponto para o mínimo" (só "pontos", nunca "pontos de índice").
 - **Dashboard > Equipe > aba Desafios** (2026-10-04, decisão do dono: encerrado continua no período filtrado; vale para Gestor e Gerente): card compacto por desafio cujo período **cruza o filtro da tela** (em andamento, a começar e encerrado — mês passado mostra o que fechou naquele mês), sem botões; clique abre o detalhe. Ordem igual à listagem de Gestão. Sem desafio no período = vazio 🔥 "Desafio não configurado".
 - Lógica pura em `challengeView.ts` / `challengeForm.ts` (com testes); dados em `challengesRepo.ts`; telas em `src/pages/challenges/` + `ChallengesPage`. Fora por enquanto: registrar prêmio como pago, desafio por faturamento, desafios na Visão geral.
50. 🟡 **Gestão > Pedido de compra** (2026-10-08: Estoque voltou a ser item direto do menu; o pedido saiu do submenu.) (2026-10-03; **implementado local** — falta `supabase db push` da migration `20261003120000_purchase_order`, deploy da Edge `erp-stock-sync` e UAT com uma loja real + importação do arquivo no Millennium) — substitui a planilha Google + Apps Script do franqueado: mesma regra e mesmo arquivo, dentro da WDash. Gestor e Gerente (gerente só nas lojas dele). Substitui a "Direção para a tela" do #47 (o saldo agora é buscado também ao abrir, não só no botão).
 - **Fonte:** **Saldo Atual e Futuro** = `MILLENIUM!FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA` (body `{ FILIAL, DESC: null, TIPO: null, DATAI: null, DATAF: null }`, 1 chamada por loja, sem período). Parser puro `supabase/functions/_shared/purchaseStock.ts` (com teste): `SALDO`/`QUANTIDADE_PEDIDO` nulos = 0, `TOTAL` ausente = saldo + pedido, múltipla ≤ 0 = sem múltipla, `DATA_CADASTRO` com −3h, linhas repetidas de código + cor + estampa + tamanho somadas, posição = ordem do relatório.
 - **Banco:** `store_purchase_stock` (loja × código × cor × estampa × tamanho: descrição, saldo, pedidos em aberto, total, múltipla, bloqueado, cadastro, posição; só a Edge grava) + `store.purchase_synced_at` + `store_purchase_min` (loja × código → `min_qty` 0..99999; grava Gestor/ADMIN_GLOBAL ou Gerente sem lojas vinculadas / com a loja vinculada). RLS de leitura por tenant.
 - **Busca:** Edge `erp-stock-sync` com `purchaseStoreIds` (2 lojas por vez; loja que falhou ou voltou vazia **mantém o saldo guardado** e vem em `purchaseFailedStores`; 401 = relogin) e atualiza o cadastro do catálogo (`set_product_catalog_registry`, best-effort). Dispara ao abrir a tela / trocar de loja quando a última busca tem **mais de 30 min** e no **Atualizar do topo** com a tela aberta. Integração desconectada ou senha inválida = não busca (só o aviso padrão).
 - **Regra (igual à planilha):** elegível para o arquivo = código sem `WP`, não bloqueado para compra, múltipla > 0. **A lista mostra o relatório inteiro** (2026-10-08), para o Saldo do rodapé fechar com o Millennium: bloqueado, WPINK e sem múltipla aparecem com mínimo já gravado só leitura e fora do arquivo. Coluna Bloqueado só no bloqueado para compra. O aviso de mais de uma cor ou tamanho não aparece no bloqueado. **Novo** = cadastrado há 0–29 dias **ou a loja nunca vendeu o produto** (2026-10-04, decisão do dono; bloqueado para compra já está fora da lista). "Nunca vendeu" = histórico da WDash (RPC `store_sold_product_codes`, `sales_product_day_agg` da loja inteira — o relatório não serve: sem período devolve 0 e período longo estoura o tempo) e **só vale quando o histórico da loja cobre 12 meses ou começa na inauguração** (`store.opened_at`; `soldHistoryCovers`) — antes disso quase tudo pareceria novo, então fica só a data de cadastro. Passa a valer sozinho quando o `DEEP_HISTORY` carregar o histórico. **A pedir** = alvo (mínimo × multiplicador 1x–5x, padrão 1x a cada abertura) − Total (negativo = 0), arredondado **para cima** até a múltipla; Total ≥ alvo ou mínimo vazio/0 = nada. Linha abaixo do mínimo fica **destacada** (fundo amarelo + marca na borda). Produto com mais de uma cor/estampa/tamanho elegível = "Mais de uma cor ou tamanho: peça direto no Millennium", A pedir "—" e fora do arquivo. Vendidos em 30 dias = `sales_product_day_agg` de D-30 a D-1 (sem chamada ao ERP). Conta pura em `src/data/wedash/purchaseOrder.ts` (com teste).
 - **Tela** (`PurchaseOrderPage` + `usePurchaseOrder`): filtros Loja (só com "Todas as lojas" e mais de 1 loja; padrão = 1ª) · Busca · Filtro (Todos os produtos · Vai para o pedido (N) · Sem mínimo (N) · Novos (N), sempre visível) · **Multiplicador do pedido** (1x–5x, com "?": multiplica o mínimo; a quantidade a pedir desconta o total e arredonda para o múltiplo) · **Gerar pedido**. "Saldo atualizado às HH:MM" abaixo dos filtros (durante a busca "Buscando saldo…"; nunca buscado "Saldo ainda não atualizado"); alerta amarelo "O saldo foi atualizado às HH:MM. O pedido pode usar quantidades desatualizadas." com mais de 30 min; falha = alerta "Não foi possível atualizar o saldo" e mantém o saldo guardado. Card **Produtos** com "N produtos · N itens no pedido" e tabela # · Produto · **Mínimo** (campo na linha: grava ao sair, Enter desce para a linha de baixo, Esc desfaz; inválido/falha = volta ao valor gravado + toast) · Saldo · Pedidos em aberto · Total em estoque · Vendidos em 30 dias · **Múltiplo de compra** · **Novo** (Sim/Não, igual à planilha; antes era selo abaixo do nome) · A pedir, cabeçalhos ordenam (padrão Produto A–Z), Total do filtro, **50 por página**.
 - **Arquivo:** `.xlsx` de 1 aba ("Página1"), nome `ddMMyyyyHHmmss.xlsx` (hora do aparelho), igual a `docs/referencias/03102026073838.xlsx`: `COD_PRODUTO · Cod_Cor · Cod_Estampa · Tamanho · Quantidade · Total em Estoque · Descricao`, 1 linha por produto com quantidade > 0, na ordem do relatório; cor/estampa/tamanho como texto (`000`, `U`), COD como número só quando é só dígitos sem zero à esquerda. Gerado sem biblioteca (`src/lib/xlsx.ts`, ZIP sem compressão). Nada a pedir = toast "Nenhum produto precisa ser incluído no pedido.". Com produtos, **Gerar pedido** abre o resumo em lista compacta (produto, quantidade × unitário e valor da linha; sem rolagem horizontal; total do pedido fixo no rodapé da janela) e a planilha só baixa em **Gerar planilha** + "Pedido gerado com N produtos.". **Custo** só no resumo: preço unitário da tabela de custo da loja (`product_cost_table_price`) e valor da linha. O total do rodapé soma essas linhas. Produto sem custo fica de fora da soma e aparece como "—" na linha, sem aviso na modal. A tabela da tela não mostra custo. O arquivo do Millennium não leva o preço. Botão desabilitado durante a busca do saldo.
 - **Copiar mínimos** (2026-10-09, decisão do dono): exportar e importar planilha saíram. O botão secundário **Copiar para outra loja** abre direto a modal **Copiar mínimos**, sempre que o acesso tem outra loja. Apoio: "Copie os mínimos de {loja} para outra loja ou para todas." Campo **Copiar para**: "Todas as outras lojas" ou "{código} · {loja}". Uma loja: "Os mínimos dos produtos em comum serão substituídos. Os demais não serão alterados." Todas: "Os mínimos dos produtos em comum serão atualizados nas outras lojas. Os demais não serão alterados." Sem pelo menos um mínimo nesta loja, o botão fica desabilitado. A loja aberta é a origem: o seletor do topo não muda. Só entra o produto que a loja de destino também tem no saldo. No produto em comum, o mínimo do destino é substituído pelo desta loja. Mínimo que só a outra loja tem permanece.
 - **Fase 2:** mínimo sugerido pelas vendas / previsão de estoque.
51. ✅ **Visão geral > Primeiros passos** (2026-10-04; migration `20261004140000_first_steps`) — card no topo da Visão geral (abaixo dos avisos, acima dos KPIs), **só Gestor**, que guia as configurações e se marca sozinho pelos dados já salvos (sem check manual). Visual (2026-10-04): tudo dentro de um card. Cabeçalho "N de 9 concluídos" + barra fina (o % fica só na barra). Copy (2026-10-04): títulos no infinitivo; apoios dizem por que o passo importa. Millennium inclui vendedores; vendedores é a carga da equipe. Grupos ligam desempenho e metas. Franquia e aluguel entram nos custos da operação e afetam o resultado operacional. Meta = "Criar uma meta". Desafio = "desafios de curto prazo". Cada passo é a linha do Task Manager (`rounded-2xl`, borda, sombra, `px-4 py-3.5`): check quadrado, título e, embaixo, a descrição; o que falta sai em negrito. Concluído só ganha o check verde, com o mesmo título. O próximo pendente ganha a faixa colorida na esquerda e o botão; os outros pendentes são um link de texto à direita. Sem avatar nem selo de prioridade.
 - **Passos, em ordem fixa:** Conectar o Millennium (sempre concluído) · Sincronizar os vendedores (sempre concluído) · Horário de funcionamento · Grupos e vendedores vinculados · Taxas da franquia · Aluguel · Impostos · Criar uma meta · Criar um desafio. Links: "Configurar funcionamento", "Criar grupos" / "Vincular vendedores", "Configurar franquia", "Configurar aluguel", "Configurar impostos", "Criar meta", "Criar desafio".
 - **Regras (`buildFirstSteps`, `src/data/wedash/firstSteps.ts`, com teste):** "Todas as lojas" vale para **todas as lojas da sessão**; **uma loja no StorePicker mostra só os passos pendentes dela** (o card só some de vez quando todas estão prontas). Passo por loja com mais de 1 loja mostra "Falta em N de M lojas". Horário = algum dia aberto. Franquia = royalties + marketing WEPINK (+ WPINK se a loja vende). Aluguel = aluguel mensal, ou só o percentual em Shopping. Impostos = ICMS e ICMS ST da WEPINK preenchidos, e também da WPINK se a loja vende (0 conta; vazio não). Grupos = todo vendedor ativo (cargo VENDEDOR) num grupo da loja ("N vendedores sem grupo"); loja com equipe e sem grupo → botão "Criar grupos". Grupos, meta e desafio só nas **lojas com equipe de vendas** (sem equipe em nenhuma = todas). Meta / desafio = existe pelo menos um da loja (qualquer período).
 - **100% = some de vez:** grava `tenant.first_steps_done_at` (RPC `complete_first_steps`, só Gestor ativo) + toast "Primeiros passos concluídos."; não volta no mês seguinte nem com loja nova.
 - **Minimizar:** clicar no cabeçalho recolhe como accordion (fica título + barra); lembrado no aparelho (`wedash.firstSteps.collapsed:{tenant}`).
 - Enquanto o card está na tela, o aviso amarelo de loja sem horário some da Visão geral (é um dos passos). Não sai no PDF.
52. ✅ **Acesso do vendedor** (2026-10-04; a tela Início está no #41) — convite em Gestão > Vendedores, coluna **Acesso**, só na aba Ativos e só com grupo ("Vincule um grupo antes de convidar."). E-mail + **Copiar link do convite** (o mesmo link do e-mail). O mesmo e-mail em outra loja da empresa liga o cadastro, sem senha nova ("Acesso liberado também nesta loja."). Estados: Sem acesso → Convite pendente → Ativo ⇄ Suspenso; cancelar ou excluir volta a Sem acesso (excluir tira só aquela loja). Quem sai do Millennium (inativo ou sumiu da lista) e estava Ativo fica **Suspenso**; convite pendente é cancelado. Reativado no Millennium continua suspenso até o Gestor ou o Gerente reativar. Login suspenso: "Seu acesso está suspenso. Fale com o responsável pelos acessos da WDash." O papel `SELLER` não lê tabela da empresa (`staff_tenant_ids()`); a tela Início só recebe o pacote da Edge `seller-home` (R$ só da própria pessoa; colegas sem valor). Menu só **Início**. Sem seletor de loja, sem Atualizar, sem Exportar e sem aviso de problema do Millennium.
---

## Ordem de construção das subtelas (DECIDIDO)
1. **Equipe** ← começamos aqui
2. Financeiro
3. Produtos
4. Visão Geral (por último — resume as 3 acima)

---

## Próximo passo concreto (aguardando seu OK nas decisões acima)

Fase atual = **refinamento de componentes, zero implementação de feature**. Quando você validar as 7 decisões, o plano de execução será:
1. Manter `nav-wedash.ts` + `router/paths` alinhados à arquitetura (Dashboard/{overview,finance,team,products} + módulos operacionais).
2. Criar os 3 componentes novos do Vela: `DateRangePicker`, `Segmented`, `CommissionLadder` (+ opcional `WaterfallChart`).
3. Filtros internos: `DateRangePicker` + `Segmented` (marca) nas subtelas.
4. Definir o contrato de dados (tipos) de cada subtela com a regra de granularidade por marca.
5. Só então montar as 4 subtelas compostas dos widgets mapeados acima.

---

## Estado atual do trabalho

- [x] Análise das 16 referências do concorrente
- [x] Análise das 3 referências de CRUD de metas
- [x] Análise das 2 referências de listagem (metas + desafios)
- [x] Definição da arquitetura de navegação
- [x] Definição do modelo de filtros
- [x] Registro das decisões neste WDASH.md
- [x] Inventário de componentes Vela disponíveis
- [x] Mapeamento de gaps de componentes
- [x] Proposta de widgets por subtela (Visão Geral, Financeiro, Equipe, Produtos)
- [ ] **Próximo passo:** validar as 6 decisões em aberto acima com o dono do produto.
- [ ] Depois: inspecionar `SidebarContent` e o combo de filial atual para propor melhoria do filtro global.
- [ ] Depois: telas operacionais (Ao Vivo, Vendedores, Metas, Desafios, Estoque, Compras, Configurações).

## Regras de trabalho
- **Não implementar nada agora.** Fase atual = refinamento e discussão de componentes.
- Registrar decisões importantes aqui para não perder contexto entre sessões.
- Tratar o usuário como dono da rede de franquias; pensar como gestor sênior ao propor métricas e layouts.

---

## Mock ASCII — Tela EQUIPE (Dashboard > Equipe)

> **Status:** PROPOSTA PARA VALIDAÇÃO — zero código escrito.
> **Foco:** performance INDIVIDUAL de vendedores (escada, ranking, desafios).
> **Filtros internos:** Período (DateRangePicker) + Marca (Segmented WEPINK/WPINK).
> **Granularidade:** 1 dia → eixo por HORA; >1 dia → eixo por DIA (independente da marca).
> **Nota:** Turnos são tela SEPARADA (Dashboard > Turnos), não toggle aqui.

### Layout — Equipe

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard > Equipe                                                 │
│  [Período: Este mês ▾]  [Marca: WEPINK | WPINK]                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ Faturamentoⓘ │ │ Premiação  ⓘ │ │ Meta do mêsⓘ │ │ Venda média   │  │
│  │ R$ 284 mil │ │ R$ 18,2 mil│ │    72%       │ │ p/ vendedoraⓘ│  │
│  │ ↗ +8% vs   │ │ ↗ +12% vs  │ │ ↘ -3% vs     │ │ R$ 12,4 mil  │  │
│  │ mês passado│ │ mês passado│ │ mês passado  │ │ ↗ +5% vs     │  │
│  │ ▁▃▅▇▆▅▇█ │ │ ▁▂▃▅▆▇▇█ │ │ ▇▆▅▃▃▂▁▁   │ │ ▁▂▃▃▅▅▆▇        │  │
│  └──────────┘ └──────────┘ └──────────────┘ └───────────────────┘  │
│   StatCard      StatCard      StatCard+Gauge     StatCard           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Escada de Premiação ⓘ  (core da tela)           [drill →]  │  │
│  │ ┌────────────┬──────────────┬────────────┬──────────────────┐ │  │
│  │ │ VENDEDORA  │ AVANÇO       │ PONTO ATEN.│ PREMIAÇÃO/PRÓX.  │ │  │
│  │ ├────────────┼──────────────┼────────────┼──────────────────┤ │  │
│  │ │ Ana Clara  │ ████░░ 4/6   │ PA 1,63 ↓  │ R$ 2.840         │ │  │
│  │ │            │ ▁▃▅▇ subindo │ 4% abaixo  │ próx: Super Meta │ │  │
│  │ ├────────────┼──────────────┼────────────┼──────────────────┤ │  │
│  │ │ Beatriz    │ █████░ 5/6   │ ✓ OK       │ R$ 3.420         │ │  │
│  │ │            │ ▅▆▇▇ estável │            │ próx: Elite      │ │  │
│  │ ├────────────┼──────────────┼────────────┼──────────────────┤ │  │
│  │ │ Carla      │ ██░░░░ 2/6   │ PA 1,41 ↓  │ R$ 1.280         │ │  │
│  │ │            │ ▃▂▁▁ caindo  │ 9% abaixo  │ próx: Meta       │ │  │
│  │ ├────────────┼──────────────┼────────────┼──────────────────┤ │  │
│  │ │ Fernanda   │ ██████ 6/6 ★ │ ✓ OK       │ R$ 4.800         │ │  │
│  │ │            │ ▇▇▇▇ MÁXIMO  │            │ 🏆 Faixa Elite   │ │  │
│  │ └────────────┴──────────────┴────────────┴──────────────────┘ │  │
│  │  CommissionLadder   Sparkline+Badge   Badge     Texto+link     │  │
│  │  ★ = faixa máxima: barra cheia + badge dourado "MÁXIMO"       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Evolução do Faturamento     │ │ Vendedoras por Faixa ⓘ       │   │
│  │ (AreaLineChart + compare)   │ │ (DonutChart)                 │   │
│  │                             │ │                              │   │
│  │  ╱╲    ╱╲                   │ │   ╭────╮                    │   │
│  │ ╱  ╲╱╱╱  ╲___               │ │  │ A 45%│ ● Abaixo Meta    │   │
│  │╱              ╲──            │ │  │ B 30%│ ● Na Meta        │   │
│  │ ─ ─ ─ ─ ─ ─ ─ ─ ─           │ │  │ C 25%│ ● Super Meta     │   │
│  │  período anterior (tracej.)  │ │   ╰────╯                    │   │
│  │                             │ │                              │   │
│  │ Eixo: DIA (>1d) / HORA (1d) │ │  Centro: "12 vendedoras"    │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Desafios Ativos ⓘ  (Accordion — ref: dashboard-desafios02)   │  │
│  │                                                               │  │
│  │ ▾ Body Cream — acima de 15 un                                │  │
│  │   produto        [████░░░░░░] 16/90 un·18%  2/6 ating. R$ 50 │  │
│  │                  projeta 72 un até o fim do período           │  │
│  │   ┌────────────────────┬───────────┬──────────┬────────────┐ │  │
│  │   │ VENDEDORA          │ PROGRESSO │ UNIDADES │ PREMIAÇÃO  │ │  │
│  │   ├────────────────────┼───────────┼──────────────────────┤ │  │
│  │   │ Bruna Teixeira     │ ██████████│ 14/15 un │ +R$ 50 ✓  │ │  │
│  │   │                    │ ▇▇▇▇ acel.│          │            │ │  │
│  │   ├────────────────────┼───────────┼──────────────────────┤ │  │
│  │   │ Ana Beatriz        │ █░░░░░░░░░│  2/15 un │ —    ↘    │ │  │
│  │   │                    │ ▁▁▂ des. │          │            │ │  │
│  │   ├────────────────────┼───────────┼──────────┼────────────┤ │  │
│  │   │ Camila, Juliana,   │           │ não      │ —    ○    │ │  │
│  │   │ Patrícia e Larissa │           │ começaram│            │ │  │
│  │   └────────────────────┴───────────┴──────────────────────┘ │  │
│  │                                                               │  │
│  │ ▸ Combo Mãe&Filha  [██░░░░] 8/40·20%  1/6 ating.  Vale R$200 │  │
│  │   (colapsado — clique para expandir)                          │  │
│  │                                                               │  │
│  │  Header: barra agregada + un/total·% + N/M atingiram + prêmio │  │
│  │  + projeção de fechamento ("projeta X un até o fim")          │  │
│  │  Linha individual: barra + un/meta + premiação(+R$ ou —)      │  │
│  │  + mini-spark tendência (acel./desacel.) + badge status       │  │
│  │  Status: ✓ atingiu · ↗ quase(>80%) · ↘ abaixo · ○ não começou│  │
│  │  Agrupa "não começaram" numa linha só (como a referência)     │  │
│  │  Ordenação: atingiu → quase → abaixo → não começou            │  │
│  │  Drill: clicar na vendedora → detalhe (produtos/dias)         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Mock ASCII — Tela TURNOS (Dashboard > Turnos)

> **Status:** PROPOSTA PARA VALIDAÇÃO — zero código escrito.
> **Foco:** análise OPERACIONAL por período do dia (manhã/tarde/noite). Comparação entre turnos cadastrados em Configurações.
> **Filtros internos:** Período (DateRangePicker) + Marca (Segmented WEPINK/WPINK) + Seletor de Turno (dropdown com turnos cadastrados; padrão = "Todos").
> **Granularidade:** mesma regra da Equipe (1 dia → HORA; >1 dia → DIA).
> **Nota:** tela SEPARADA de Equipe. KPIs próprios, comparativos entre turnos.

### Extraído do BI atual (referencia11.jpeg — "Dashboard Gerencial")
A referência tem 6 blocos; mapeamos os relevantes para esta tela:
| Bloco no BI | Como entra na nossa tela de Turnos |
|---|---|
| **R$ Faturamento por Turno - Geral** (donut: Turno 1 vs Turno 2 com % e R$) | → vira o **DonutChart** de participação por turno (já previsto como comparativo). Mostra R$ e % de cada turno no total. |
| **R$ Faturamento por Turno - Dia da Semana** (barras horizontais por dia, T1 vs T2, com R$ em cada barra) | → vira o **StackedBarChart / BarChart** "Faturamento por Dia da Semana × Turno". **Valores em R$ direto na barra** (regra `showValues`). |
| **R$ Faturamento, Vendas e T.M por Turno** (cards Turno 1 / Turno 2 com Faturamento, Vendas, T. Médio) | → vira os **KPIs por turno** (Faturamento por Turno, Ticket Médio por Turno) + card resumo por turno. Confirma a estrutura de KPIs multi-turno que já definimos. |
| **Indicadores por Hora** (tabela: Hora, R$ Fat, Vendas, Ticket Médio, % Fat por Hora, Fat. ACM, % Fat. ACM) | → vira a **DataTable "Indicadores por Hora"** (já no mock). Adicionamos as colunas **% do faturamento do dia** e **acumulado (%)** que o BI tem — respondem "que horas concentram a venda?". |
| **R$ Faturamento por Turno - Vendedora** (ranking horizontal por vendedora, com R$ ao lado da barra, filtrado por turno) | → vira o **ranking de vendedoras por turno** (BarChart horizontal com `showValues`). Responde "quem puxou o resultado neste turno?". |

> Os valores em R$ aparecem **direto nas barras/linhas** em todos esses blocos no BI — isso virou a regra `showValues` registrada acima.

### Layout — Turnos

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard > Turnos                                                │
│  [Período: Este mês ▾] [Marca: WEPINK|WPINK] [Turno: Todos ▾]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────────────┐  │
│  │ Faturamento   │ │ Vendas      │ │ Ticket Médio  │ │ Meta do período         │  │
│  │ por Turno   ⓘ │ │ por Turno ⓘ │ │ por Turno   ⓘ │ │ por Turno             ⓘ │  │
│  │               │ │             │ │               │ │                         │  │
│  │ Manhã:R$168mil│ │ Manhã:2.154 │ │ Manhã: R$ 78  │ │   ╭───╮                 │  │
│  │ Tarde:R$116mil│ │ Tarde:1.812 │ │ Tarde:  R$ 64 │ │  │68%│ Manhã           │  │
│  │ Noite:R$82mil │ │ Noite:1.410 │ │ Noite:  R$ 58 │ │   ╰───╯                 │  │
│  │ ▁▃▅▆▅▇█      │ │ ▃▅▅▃▂      │ │ ▅▆▇▆▅▂      │ │ vs Tarde: ↗ +22%        │  │
│  └───────────────┘ └───────────────┘ └───────────────┘ └─────────────────────────┘  │
│   StatCard(multi)   StatCard(multi)   StatCard(multi)   Gauge+comparativo           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Faturamento por Dia × Turno ⓘ  (StackedBarChart)             │  │
│  │                                                               │  │
│  │  Seg  Ter  Qua  Qui  Sex  Sáb  Dom                            │  │
│  │  ██   ██   ██   ██   ██   ██   ░░   ← Manhã                 │  │
│  │  ▓▓   ▓▓   ▓▓   ▓▓   ▓▓   ▓▓   ▓▓   ← Tarde                 │  │
│  │  ░░   ░░   ░░   ░░   ░░   ░░   ░░   ← Noite                 │  │
│  │                                                               │  │
│  │  Legenda: ██ Manhã  ▓▓ Tarde  ░░ Noite                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Mapa de Calor por Hora ⓘ  (Heatmap dia × hora)               │  │
│  │ (filtrado pelo turno selecionado ou todos)                    │  │
│  │                                                               │  │
│  │       08  09  10  11  12  13  14  15  16  17  18  19  20     │  │
│  │  Seg  ░░  ▒▒  ██  ██  ▓▓  ░░  ▒▒  ██  ██  ▓▓  ░░  ░░  ░░   │  │
│  │  Ter  ░░  ▒▒  ██  ▓▓  ▓▓  ░░  ▒▒  ▓▓  ██  ██  ▓▓  ░░  ░░   │  │
│  │  Qua  ░░  ▒▒  ▒▒  ██  ██  ▓▓  ██  ██  ▓▓  ▓▓  ░░  ░░  ░░   │  │
│  │  ...                                                          │  │
│  │  ░=baixo ▒=médio ▓=alto █=pico                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Indicadores por Hora ⓘ  (condicional: período = 1 dia)       │  │
│  │ ┌────────┬──────────┬──────────┬──────────┬────────────────┐ │  │
│  │ │ Hora   │ Faturam. │ Atendim. │ Ticket   │ Vs. mesmo hor. │ │  │
│  │ ├────────┼──────────┼──────────┼──────────┼────────────────┤ │  │
│  │ │ 09:00  │ R$ 2.4k  │   18     │ R$ 133   │ ↗ +12%         │ │  │
│  │ │ 10:00  │ R$ 3.8k  │   24     │ R$ 158   │ ↗ +8%          │ │  │
│  │ │ 11:00  │ R$ 4.2k  │   31     │ R$ 135   │ ↘ -3%          │ │  │
│  │ └────────┴──────────┴──────────┴──────────┴────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Vendedoras por Hora ⓘ  (BarChart: reais vs. mínimo ideal)    │  │
│  │ Quantas vendedoras ativas em cada hora vs. mínimo ideal      │  │
│  │                                                               │  │
│  │  08  09  10  11  12  13  14  15  16  17  18  19  20          │  │
│  │  ██  ██  ██  ██  ▓▓  ██  ██  ██  ▓▓  ██  ██  ░░  ░░          │  │
│  │  ──  ──  ──  ──  ──  ──  ──  ──  ──  ──  ──  ──  ──  (meta) │  │
│  │                                                               │  │
│  │  ██ = staff real   ── = meta mínima                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Componentes Vela mapeados para Turnos

| Widget | Componente existente | Gap / Novo |
|---|---|---|
| KPIs multi-turno | `StatCard` (multi-linha via composição) | ✅ Composição |
| Gauge comparativo | `Gauge` + texto | ✅ Reusa |
| Comparativo turnos | `StackedBarChart` | ✅ Reusa |
| Heatmap hora×dia | `Heatmap` | ✅ Reusa |
| Indicadores por hora | `DataTable` | ✅ Reusa |
| Cobertura de staff | `BarChart` | ✅ Reusa |
| Seletor de turno | — | 🔨 Criar `Select` custom ou reusar `Dropdown` |

### Perguntas de decisão que esta tela responde

1. **"Qual turno vende mais?"** → KPIs comparativos + StackedBar.
2. **"Tem gente suficiente em cada horário?"** → Heatmap + Vendedoras por Hora.
3. **"O turno da manhã está batendo a meta?"** → Gauge com comparativo entre turnos.
4. **"Quais horários vendem mais no meu turno?"** → Heatmap filtrado por turno.
5. **"O valor por venda muda muito entre turnos?"** → StatCard Ticket Médio + drill para Indicadores por Hora.

### Grade responsiva — quantos cards por linha (Turnos)
Regra geral: **KPIs em 4 colunas no desktop** (padronizado com as demais telas — Faturamento, Vendas, Ticket Médio e Meta do período, todos por turno). Os cards de gráfico/tabela **não ficam todos 1 por linha** — agrupamos em pares de 2 colunas no desktop onde o conteúdo permite, e reservamos largura total só para o que realmente exige espaço horizontal (barras por dia da semana, heatmap, tabela com muitas colunas). Tablet = 2 KPIs/linha e cards 1/linha; Mobile = 1 por linha com scroll-x onde necessário.
| Bloco | Desktop (lg ≥1024px) | Tablet (md ≥768px) | Mobile (<768px) |
|---|---|---|---|
| KPI row (4 StatCards multi-turno) | **4 por linha** (`sm:grid-cols-2 lg:grid-cols-4`) | 2 por linha | 1 por linha |
| Faturamento por Dia × Turno | **1 por linha** (largura total — 7 dias em barras horizontais precisam de espaço) | 1 por linha | 1 por linha (scroll-x) |
| Mapa de Calor por Hora + Vendedoras por Hora | **2 por linha** (`lg:grid-cols-2`) — ambos são "intensidade por hora", cabem lado a lado | 1 por linha | 1 por linha (scroll-x no heatmap) |
| Indicadores por Hora | **1 por linha** (largura total — tabela com várias colunas) | 1 por linha | 1 por linha (scroll-x) |

> Tailwind: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5` para os KPIs (padronizado com as demais telas); `lg:grid-cols-2` para o par (Mapa de Calor + Vendedoras por Hora); largura total (`lg:col-span-full`) para Faturamento por Dia e Indicadores por Hora. Tabelas e heatmap ganham `overflow-x-auto` no mobile.
> **Por que não tudo 1 por linha:** deixar cada card ocupando a linha inteira no desktop desperdiça espaço lateral e obriga o gestor a rolar muito. O par "Mapa de Calor + Vendedoras por Hora" divide bem a tela porque os dois respondem à mesma pergunta ("como foi cada hora?") e têm altura compatível. Só o gráfico de 7 dias e a tabela horária justificam largura total.
> **Critério usado (vale para todas as telas):** um card fica em largura total quando (a) tem muitas categorias no eixo horizontal (7 dias, 10+ produtos), (b) é uma tabela com ≥5 colunas, ou (c) é o widget central da tela. Caso contrário, agrupa em par de 2 colunas no desktop.

---

## Glossário — termos usados nos mocks (só os não óbvios)

> Objetivo: qualquer gestor, independente de senioridade, entende o que cada card mostra.
> Termos como "faturamento", "vendas", "meta" não entram aqui — são do dia a dia.

| Termo no mock | O que significa, em linguagem simples |
|---|---|
| **Valor médio por venda** | Quanto, em média, cada cliente gasta numa compra. Se vender R$ 1.000 em 10 vendas, o valor médio é R$ 100. Ajuda a saber se o cliente está comprando mais ou menos por vez. |
| **Batemos a meta?** | Percentual do quanto já vendemos frente ao que era esperado vender no período. 72% = faltam 28% pra fechar a meta. |
| **Cada uma vendeu** | Quanto, em média, cada vendedora trouxe de venda no período. Útil pra saber se o resultado veio de poucas pessoas ou se a equipe toda está produzindo. |
| **Vou pagar de premiação?** | Quanto a loja vai desembolsar em prêmios/comissões se o mês fechar como está agora. Ajuda a projetar o custo com a equipe. |
| **Escada de premiação** | As faixas de prêmio que a vendedora sobe conforme vende mais (ex.: Meta → Super Meta → Elite). A barra mostra em que degrau ela está. |
| **Ponto de atenção (PA)** | Sinal de que aquela vendedora está vendendo abaixo do ritmo esperado pro preço médio dela. "PA 1,63 ↓ · 4% abaixo" = ela precisa vender um pouco mais por cliente pra não cair de faixa. |
| **Faixa máxima (★ MÁXIMO)** | A vendedora já chegou no topo da escada de premiação. Não há próximo degrau — ela atingiu o prêmio máximo. |
| **Projeta X até o fim** | Estimativa de onde o número vai chegar se o ritmo atual se mantiver até o fim do período. Responde "vamos bater ou não?". |
| **Cobertura de staff** | Quantas vendedoras estão trabalhando em cada hora, comparado com o mínimo ideal. Se a barra está abaixo da linha de meta naquele horário, falta gente. |
| **Heatmap (mapa de calor)** | Grade que mostra, por cor, onde vendeu mais: dias da semana × horas. Cor forte = pico de venda; cor fraca = horário parado. |
| **Acelerando / desacelerando** | Mini-gráfico ao lado da vendedora no desafio: mostra se ela está ganhando ritmo (acelerando) ou perdendo (desacelerando) rumo à meta do desafio. |

### Componentes Vela mapeados para este mock

| Widget | Componente existente | Gap / Novo |
|---|---|---|
| KPI row (4 cards) | `StatCard` + `Sparkline` | ✅ Reusa |
| Filtro período interno | — | 🔨 Criar `DateRangePicker` |
| Filtro marca interno | — | 🔨 Criar `Segmented` (WEPINK/WPINK) |
| Escada de premiação | — | 🔨 Criar `CommissionLadder` (renomeado p/ Premiação) |
| Faixa máxima (★ MÁXIMO) | `CommissionLadder` + `Badge` dourado | ✅ Composição |
| Ponto de atenção badge | `Badge` variant warning | ✅ Composição |
| Tendência textual + spark | `Sparkline` + `Badge` | ✅ Composição |
| Evolução faturamento | `AreaLineChart` (compareData) | ✅ Reusa |
| Distribuição faixas | `DonutChart` | ✅ Reusa |
| Desafios ativos (expandível) | `Accordion` + `DataTable` interna + `ProgressBar` | ✅ Composição |

### Perguntas de decisão que esta tela responde

1. **"Quem está batendo meta e quem precisa de intervenção?"** → Escada de comissão com PA e tendência.
2. **"Quanto vou pagar de comissão se o mês fechar assim?"** → StatCard comissão projetada + próximo degrau na tabela.
3. **"Os desafios estão engajando a equipe?"** → Tabela de desafios com progresso e engajadas.
4. **"Estamos melhor ou pior que o mês passado?"** → Delta em todos os StatCards + linha tracejada no AreaLineChart.
5. **"Como evoluiu o faturamento da equipe no período?"** → AreaLineChart com comparativo.

### Notas de design

- **Escada de premiação é o widget central** — ocupa largura total, acima dos gráficos. É o diferencial analítico vs. concorrente.
- **Faixa máxima**: quando a vendedora atinge o topo da escada, a barra fica cheia (6/6) + badge dourado "★ MÁXIMO" + texto "🏆 Faixa Elite". Não há "próximo degrau" — ela já chegou.
- **Desafios usam Accordion**: cada desafio é um item colapsável. O header mostra progresso agregado + engajadas + prêmio. Ao expandir, revela `DataTable` com desempenho individual (vendedora, vendas, % meta, status). Permite ver quem está puxando o resultado sem poluir a visão geral.
- **Turnos são tela SEPARADA** (Dashboard > Turnos) — esta tela foca exclusivamente no indivíduo.
- **Tabela de indicadores por hora é condicional** — só renderiza quando `escopo.periodo` resulta em granularidade horária.
- **Todos os números têm os 4 elementos**: valor + comparativo + tendência + drill-down (link ou tooltip).
- **Zero botões de ação CRUD** dentro desta tela. Tudo é leitura analítica.

### Grade responsiva — quantos cards por linha (Equipe)
**Critério unificado (vale para TODAS as telas):** um card fica em **largura total** quando (a) tem muitas categorias no eixo horizontal (7 dias, 10+ produtos), (b) é tabela com ≥5 colunas, ou (c) é o widget central da tela. Caso contrário, **agrupa em par de 2 colunas** no desktop. KPIs sempre em linha cheia (4 no desktop). Tablet = 2 KPIs/linha e cards 1/linha; Mobile = tudo 1/linha com scroll-x onde necessário.
| Bloco | Desktop (lg ≥1024px) | Tablet (md ≥768px) | Mobile (<768px) |
|---|---|---|---|
| KPI row (4 StatCards) | **4 por linha** (`sm:grid-cols-2 lg:grid-cols-4`) | 2 por linha | 1 por linha |
| Escada de Premiação | **1 por linha** (largura total — widget central, critério c) | 1 por linha | 1 por linha |
| Evolução do Faturamento + Vendedoras por Faixa | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
| Desafios Ativos | **1 por linha** (largura total — Accordion com tabela interna, critério b) | 1 por linha | 1 por linha |

> Tailwind: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5` para os KPIs; `lg:grid-cols-2` para o par de gráficos; largura total (`lg:col-span-full`) para Escada e Desafios. Tabelas ganham `overflow-x-auto` no mobile.

---

## Mock ASCII — Tela FINANCEIRO (Dashboard > Financeiro)

> **Status:** PROPOSTA PARA VALIDAÇÃO — zero código escrito.
> **Foco:** saúde financeira da loja/rede — quanto entra, quanto custa, quanto sobra, e onde vaza margem.
> **Filtros internos:** Período (DateRangePicker) + Marca (Segmented WEPINK/WPINK).
> **Granularidade:** mesma regra (1 dia → HORA; >1 dia → DIA).
> **Nota:** 100% leitura analítica. Zero CRUD. Ações financeiras (pagar conta, gerar DRE exportável) ficam fora do dashboard.

### Extraído do BI atual (referencia02/03/04.jpeg — blocos financeiros)
| Bloco no BI | Como entra na nossa tela Financeiro |
|---|---|
| **CMV, Lucro Bruto e % Margem - Mensal** (barras empilhadas CMV+Lucro com linha de % margem; valores `92K/138K` direto nas barras; tooltip com CMV, % Margem, Faturamento, CMV Médio) | → vira o card **Custo, Lucro e Margem** (StackedBarChart CMV+Lucro Bruto + AreaLine de % Margem sobreposto). **Valores em R$ direto nas barras** (`showValues`). É o widget central da tela. |
| **Qtd Itens Vendidos vs PA - Mensal** (barras de quantidade com linha de PA; valores `1.903 / 1,57` direto) | → vira o card **Itens Vendidos vs Preço Médio** (BarChart de qty + AreaLine de PA/Ticket). Responde "estou vendendo mais unidades ou só mais caro?". |
| **Vendas vs Ticket Médio - Mensal** (linha de vendas + linha de ticket) | → **removido do Financeiro** (diagnóstico sem ação financeira clara; ticket fica na Evolução Mensal). |
| **R$ Faturamento por Forma de Pagamento** (donut: Crédito R$66mil 43%, Débito R$39mil 26%, Pix, Dinheiro R$16mil...) | → vira o card **Faturamento por Forma de Pagamento** (DonutChart com R$ e % por forma). Responde "como o cliente está pagando?" (impacta taxa da maquininha/prazo de recebimento). |
| Tooltip do BI (Mês, CMV, % Margem, Faturamento, CMV Médio) | → vira o **tooltip rico** dos gráficos + as colunas da tabela de evolução mensal. |
| **(NOVO — pedido do gestor, não estava no BI)** Custos da operação: Aluguel (Fixo + variável shopping), Royalties, Marketing (WEPINK e WPINK) | → vira o card **Custos da Operação** (DataTable tipo mini-DRE: lista cada custo, soma, e desconta do Lucro Bruto → **Resultado Operacional**). É a ponte entre Lucro Bruto e o futuro Lucro Líquido. |

> **Escopo financeiro decidido:** esta tela vai do **Faturamento → CMV → Lucro Bruto → (− Custos da Operação) → Resultado Operacional**. Os custos extras restantes (folha completa, utilities, depreciação, impostos sobre lucro etc.) e o **Lucro Líquido** ficam para a **futura aba DRE** (fora deste dashboard). O card "Custos da Operação" já deixa o gancho visual para essa evolução.

### Layout — Financeiro

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard > Financeiro                                             │
│  [Período: Este mês ▾]  [Marca: WEPINK | WPINK]                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐│
│  │ Faturamentoⓘ │ │ Custo dos    │ │ Lucro        │ │ Margem       ││
│  │              │ │ produtos   ⓘ │ │ bruto      ⓘ │ │            ⓘ ││
│  │ R$ 284 mil   │ │ R$ 114 mil   │ │ R$ 170 mil   │ │   60%        ││
│  │ ↗ +8% vs     │ │ ↗ +5% vs     │ │ ↗ +11% vs    │ │ ↗ +2 p.p. vs ││
│  │ mês passado  │ │ mês passado  │ │ mês passado  │ │ mês passado  ││
│  │ ▁▃▅▇▆▅▇█     │ │ ▁▂▃▃▅▅▆▇     │ │ ▁▃▅▆▇▇██     │ │ ▃▅▅▆▆▇▇█     ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘│
│   StatCard        StatCard        StatCard        StatCard          │
│   (ⓘ = tooltip com explicação simples do KPI)                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Custo, Lucro e Margem ⓘ  (widget central)                    │  │
│  │ (StackedBarChart CMV+Lucro Bruto + AreaLine % Margem)         │  │
│  │                                                               │  │
│  │  %margem: 53% ··· 49% ··· 50% ··· 49% ··· 48% ··· 51% ··· 54% │  │
│  │           ╭──────────────────────────────────────────────╮    │  │
│  │  mar abr mai jun jul ago set out nov dez                  │    │
│  │  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░   ← Lucro Bruto  │    │
│  │  ██  ██  ██  ██  ██  ██  ██  ██  ██  ██   ← Custo (CMV)   │    │
│  │  92K 138K 109K ... 221K  (R$ direto em cada barra)         │    │
│  │                                                               │  │
│  │  Legenda: ██ Custo  ░░ Lucro  ┄ % Margem                    │  │
│  │  Tooltip: Mês · Custo · % Margem · Faturamento · Custo médio│  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Faturamento vs Ticket Médio │ │ Itens Vendidos vs Preço Médio│   │
│  │ (AreaLineChart 2 séries)    │ │ (BarChart qty + AreaLine PA) │   │
│  │                             │ │                              │   │
│  │  ╱╲    ╱╲  ← faturamento    │ │  1,97                        │   │
│  │ ╱  ╲╱╱╱  ╲  ┄ ticket médio  │ │   ·  1,57 · 1,61 ··· 1,59   │   │
│  │                             │ │  █   █   █   █   █   █   █   │   │
│  │  R$ direto nos pontos       │ │ 1903 3723 5655 ... 6826      │   │
│  │                             │ │  (qty direto em cada barra)  │   │
│  │                             │ │  Legenda: █ Itens  · Preço   │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Formas de Pagamento ⓘ       │ │ Custos da Operação ⓘ         │   │
│  │ (DonutChart)                │ │ (mini-DRE: Lucro Bruto       │   │
│  │                             │ │  − custos da operação        │   │
│  │   ╭────╮  ● Crédito  43%    │ │  = Resultado Operacional)    │   │
│  │  │66mil│  ● Débito   26%    │ │                              │   │
│  │  │     │  ● Pix      16%    │ │  Lucro bruto        R$ 170 mil│   │
│  │   ╰────╯  ● Dinheiro 11%    │ │  (−) Aluguel fixo    R$  18 mil│   │
│  │         ● Outros      4%    │ │  (−) Aluguel variável R$  9 mil│   │
│  │  R$ e % por forma de pgto   │ │  (−) Royalties       R$  12 mil│   │
│  │  (ref: referencia04.jpeg)   │ │  (−) Marketing WEPINK R$  6 mil│   │
│  │                             │ │  (−) Marketing WPINK  R$  4 mil│   │
│  │                             │ │  ─────────────────────────────│   │
│  │                             │ │  = Resultado Operac. R$ 121 mil│   │
│  │                             │ │  (custos extras/lucro líquido  │   │
│  │                             │ │   → futura aba DRE)           │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Evolução Mensal ⓘ  (DataTable — resumo tipo DRE simplificado)│  │
│  │ ┌────────┬──────────┬──────────┬──────────┬────────┬────────┐ │  │
│  │ │ Mês    │ Faturam. │ Custo    │ Lucro    │ Margem │ Ticket │ │  │
│  │ ├────────┼──────────┼──────────┼──────────┼────────┼────────┤ │  │
│  │ │ jul    │ R$ 220k  │ R$ 114k  │ R$ 106k  │  48%   │ R$ 24  │ │  │
│  │ │ ago    │ R$ 235k  │ R$ 118k  │ R$ 117k  │  50%   │ R$ 25  │ │  │
│  │ │ ...    │          │          │          │        │        │ │  │
│  │ └────────┴──────────┴──────────┴──────────┴────────┴────────┘ │  │
│  │  DataTable com valores em R$ + variação vs mês anterior       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Componentes Vela mapeados para Financeiro

| Widget | Componente existente | Gap / Novo |
|---|---|---|
| KPI row (4 cards) | `StatCard` + `Sparkline` | ✅ Reusa |
| Filtro período interno | — | 🔨 Criar `DateRangePicker` (já previsto) |
| Filtro marca interno | — | 🔨 Criar `Segmented` (já previsto) |
| CMV, Lucro e Margem | `AreaLineChart` (Lucro vs CMV + margem no header) — mesmo padrão da VG | ✅ Reusa |
| Resultado operacional | `AreaLineChart` (Lucro vs Resultado + margem op. no header) — par do CMV/Lucro | ✅ Reusa |
| Faturamento vs Ticket Médio | `AreaLineChart` (2 séries) | ✅ Reusa (+ `showValues`) |
| Itens Vendidos vs Preço Médio | `BarChart` + `AreaLineChart` (PA) | ✅ Composição (+ `showValues`) |
| Faturamento por Forma de Pagamento | `DonutChart` | ✅ Reusa (R$ e % por forma) |
| Custos da Operação (mini-DRE) | `DataTable` (linhas de custo + total) ou composição simples de linhas | ✅ Reusa (`DataTable`/lista) — desconta do Lucro Bruto → Resultado Operacional |
| Evolução Mensal (DRE simplif.) | `DataTable` | ✅ Reusa |
| WaterfallChart (DRE em cascata) | — | 🟡 Opcional (decisão #4). Se criado, substitui/complementa a tabela de evolução |

### Perguntas de decisão que esta tela responde

1. **"Estou ganhando ou perdendo dinheiro?"** → KPI Lucro Bruto + Margem, e o widget central Custo/Lucro/Margem.
2. **"Onde está vazando minha margem?"** → StackedBar mostrando Custo vs Lucro ao longo dos meses + % Margem em queda/subida.
3. **"Estou vendendo mais unidades ou só mais caro?"** → Itens Vendidos vs Preço Médio (qty sobe mas PA cai = vendendo mais barato).
4. **"Meu ticket médio está subindo ou caindo, e por quê?"** → Faturamento vs Ticket Médio + drill para a tabela mensal.
5. **"Estamos melhor ou pior que o mês passado?"** → Delta em todos os KPIs + comparativo na tabela mensal.

### Grade responsiva — quantos cards por linha (Financeiro)

Regra geral: **KPIs em 4 colunas no desktop**, widget central em largura total, par de gráficos em 2 colunas, tabela em largura total. Mobile empilha tudo em 1 coluna.

| Bloco | Desktop (lg ≥1024px) | Tablet (md ≥768px) | Mobile (<768px) |
|---|---|---|---|
**Critério unificado (vale para TODAS as telas):** um card fica em **largura total** quando (a) tem muitas categorias no eixo horizontal, (b) é tabela com ≥5 colunas, ou (c) é o widget central da tela. Caso contrário, **agrupa em par de 2 colunas** no desktop. KPIs sempre em linha cheia (4 no desktop). Tablet = 2 KPIs/linha e cards 1/linha; Mobile = tudo 1/linha com scroll-x onde necessário.
| KPI row (4 StatCards) | **4 por linha** (`sm:grid-cols-2 lg:grid-cols-4`) | 2 por linha | 1 por linha |
| Custo, Lucro e Margem + Resultado operacional | **2 por linha** (`lg:grid-cols-2`) — par Lucro×CMV / Lucro×Resultado | 1 por linha | 1 por linha |
| Faturamento vs Ticket + Itens vs Preço | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
| Formas de Pagamento + Custos da Operação | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
| Evolução Mensal | **1 por linha** (largura total — tabela ≥5 colunas, critério b) | 1 por linha | 1 por linha (scroll-x) |

> Tailwind: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5` para os KPIs; `lg:grid-cols-2` para os pares (CMV/Lucro + Resultado, Formas de Pagamento + Custos da Operação); largura total para a Evolução Mensal. Tabelas ganham `overflow-x-auto` no mobile.

### Glossário — termos financeiros (só os não óbvios)

| Termo no mock | O que significa, em linguagem simples |
|---|---|
| **Custo dos produtos (CMV)** | Quanto a loja gastou para comprar os produtos que vendeu no período. Se vendeu R$ 284 mil e o custo foi R$ 114 mil, sobraram R$ 170 mil antes das outras despesas. |
| **Lucro bruto** | O que sobra da venda depois de tirar o custo dos produtos (Faturamento − Custo). Ainda não desconta aluguel, salário etc. — é o "lucro da venda em si". |
| **Margem (%)** | Quantos centavos de lucro cada R$ 1 vendido deixa. Margem 60% = de cada R$ 100 vendidos, R$ 60 sobram (antes das despesas). Se a margem cai, ou o custo subiu, ou você está dando mais desconto. |
| **Preço Médio (PA)** | Valor médio de cada item vendido (Faturamento ÷ Qtd de itens). Diferente do Ticket Médio: o PA é por ITEM, o Ticket é por COMPRA. |
| **Ticket Médio** | Valor médio de cada compra/atendimento (Faturamento ÷ Nº de vendas). Mostra se o cliente está levando mais ou menos por vez. |
| **p.p. (pontos percentuais)** | Variação absoluta de uma porcentagem. Margem foi de 58% para 60% = "+2 p.p." (não é "+2%", que seria relativo). |
| **Margem operacional** | Resultado operacional ÷ Faturamento. Quanto sobra de cada R$ 1 vendido depois dos custos da operação. |
| **Resultado Operacional** | O que sobra do Lucro Bruto depois de tirar os custos da operação (aluguel, royalties, marketing). É o "lucro do dia a dia da loja", antes dos custos extras e impostos. |
| **Custos da Operação** | Aluguel (fixo + variável shopping), royalties e marketing da franquia — custos que a loja paga para operar, descontados do lucro bruto. |
| **Aluguel variável shopping** | Em shoppings, além do aluguel fixo você paga um percentual do faturamento (ex.: 5% das vendas). Os dois juntos (fixo + variável) são o custo total de ocupação. |
| **Royalties** | Percentual do faturamento pago à franqueadora (WEPINK/WPINK) pelo uso da marca. É um custo da franquia, independente de a loja lucrar ou não. |
| **Marketing (Franquia)** | Percentual do faturamento destinado ao fundo de propaganda da marca (campanhas nacionais/regionais). Geralmente há uma taxa para WEPINK e outra para WPINK. |
| **Forma de Pagamento** | Como o cliente pagou (Crédito, Débito, Pix, Dinheiro). Importa porque cada forma tem um custo/prazo diferente: crédito demora pra cair e tem taxa da maquininha; Pix cai na hora e é mais barato. |
| **DRE / Lucro Líquido (futura aba)** | Demonstrativo completo que parte do Resultado Operacional e desconta o resto (folha completa, luz/água, depreciação, impostos sobre lucro) até o Lucro Líquido final. Fica fora deste dashboard, numa aba dedicada futura. |

---
## Mock ASCII — Tela PRODUTOS (Dashboard > Produtos)
> **Status:** PROPOSTA PARA VALIDAÇÃO — zero código escrito.
> **Foco:** desempenho do mix de produtos — o que vende, o que dá margem, o que está parado ou em ruptura.
> **Filtros internos:** Período (DateRangePicker — extrair de `DatePickersPage.tsx`) + Marca (Segmented WEPINK/WPINK) + Categoria (Dropdown/Select).
> **Granularidade:** mesma regra (1 dia → HORA; >1 dia → DIA).
> **Nota:** 100% leitura analítica. Zero CRUD. Cadastro/edição de produto fica fora do dashboard.
> **Base:** `referencia08.jpeg` (BI atual: R$ Produtos por Categoria, R$ Linha Produto, Ranking por Produto, Tabela de Produtos). Melhorias aplicadas abaixo.

### Extraído do BI atual (referencia08.jpeg — blocos de produtos)
| Bloco no BI | Como entra na nossa tela Produtos | Melhoria vs. BI |
|---|---|---|
| **R$ Produtos por Categoria** (barras por categoria BODY/PERF/HAIR/MAKE/SKIN/BATH + linha de % Margem; valores `178K/159K` direto nas barras) | → card **Faturamento por Categoria** (BarChart + AreaLine % Margem sobreposto, `showValues`). | Adicionamos delta vs período anterior por categoria + clique na barra filtra a tabela abaixo. |
| **R$ Linha Produto** (ranking horizontal: OBSESSED 36K, GOLDEN 31K, HEAVEN 30K...) | → card **Top Linhas de Produto** (BarChart horizontal, `showValues`). | Drill: clicar numa linha filtra a tabela por aquela linha. |
| **Ranking por Produto** (ranking horizontal com seletor "Faturamento" no topo; DESOD COL VF GOLDEN 19K...) | → card **Top Produtos** (BarChart horizontal + `Segmented`/`Select` para ordenar por Faturamento / Qtd Vendida / Margem). | O BI só ordena por faturamento; nós deixamos o gestor escolher a métrica do ranking. |
| **Tabela de Produtos** (Categoria, Faturamento, CMV, Lucro Bruto, % Margem, CMV%, Qtd Vendas, Ticket Médio, Qtd Itens Vendidos, T.M por Itens) | → card **Tabela de Produtos** (DataTable com as mesmas colunas + busca "Pesquisar Produto" + botão "Ver Tabela Completa"). | Adicionamos coluna de tendência (↗/↘) + dias de cobertura/estoque + badge de ruptura. Responde "vou perder venda por falta?". |

### Layout — Produtos
```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard > Produtos                                               │
│  [Período: Este mês ▾] [Marca: WEPINK|WPINK] [Categoria: Todas ▾]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐│
│  │ Faturamentoⓘ │ │ Lucro        │ │ Margem       │ │ Itens        ││
│  │              │ │ bruto      ⓘ │ │            ⓘ │ │ vendidos   ⓘ ││
│  │ R$ 352 mil   │ │ R$ 199 mil   │ │   57%        │ │  5.778       ││
│  │ ↗ +6% vs     │ │ ↗ +9% vs     │ │ ↗ +1 p.p. vs │ │ ↗ +4% vs     ││
│  │ mês passado  │ │ mês passado  │ │ mês passado  │ │ mês passado  ││
│  │ ▁▃▅▇▆▅▇█     │ │ ▁▃▅▆▇▇██     │ │ ▃▅▆▆▇▇█     │ │ ▁▂▃▃▅▅▆▇     ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘│
│   StatCard        StatCard        StatCard        StatCard          │
│   (ⓘ = tooltip com explicação simples do KPI)                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Faturamento por Categoria ⓘ  (widget central)                │  │
│  │ (BarChart por categoria + AreaLine % Margem sobreposto)       │  │
│  │                                                               │  │
│  │  %margem: 62% ··· 50% ··· 60% ··· 67% ··· 67% ··· 100%        │  │
│  │           ╭──────────────────────────────────────────────╮    │  │
│  │  BODY PERF HAIR MAKE SKIN BATH                            │    │
│  │  ███  ███  ██   █    █    ▁                               │    │
│  │ 178K 159K  11K  2K   2K  766   (R$ direto em cada barra)  │    │
│  │                                                               │  │
│  │  Legenda: █ Faturamento  ┄ % Margem                          │  │
│  │  Clique numa barra → filtra a Tabela de Produtos abaixo      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Top Linhas de Produto       │ │ Top Produtos                 │   │
│  │ (BarChart horizontal)       │ │ (BarChart horizontal +       │   │
│  │                             │ │  ordenação: [Faturamento ▾]) │   │
│  │  OBSESSED  ████████████ 36K │ │  DESOD COL VF GOLDEN  ███ 19K│   │
│  │  GOLDEN    ██████████   31K │ │  BODY SPLASH VF GOLDEN ██ 10K│   │
│  │  HEAVEN    █████████    30K │ │  DESOD COL OBSESSED    ██ 10K│   │
│  │  LIBERTE   ███████      22K │ │  ...                         │   │
│  │  ...                        │ │  Ordenar por: Faturamento /  │   │
│  │  R$ direto em cada barra    │ │  Qtd Vendida / Margem        │   │
│  │  Clique → filtra a tabela   │ │  Clique → drill do produto   │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Tabela de Produtos ⓘ  [🔍 Pesquisar]      [Ver Tabela Completa →]│
│  │ ┌──────────┬─────────┬────────┬────────┬───────┬──────┬───────┬────────┬──────┬──────┐│
│  │ │Categoria │Faturam. │ CMV    │Lucro   │Margem │CMV%  │Qtd V. │Ticket  │Itens │T.M/it││
│  │ ├──────────┼─────────┼────────┼────────┼───────┼─────────────┼────────┼────────────┤│
│  │ │PERFUMARIA│R$158.734│R$79.183│R$79.550│  50%  │ 50%  │ 1.247 │R$127,29│1.549 │R$102 ││
│  │ │BODY SPL. │R$177.990│R$68.087│R$109.9 │  62%  │ 38%  │ 2.852 │R$ 62,41│3.933 │R$ 45 ││
│  │ │HAIR      │R$ 10.589│R$ 4.223│R$ 6.366│  60%  │ 40%  │   165 │R$ 64,18│  198 │R$ 53 ││
│  │ │...       │         │        │        │       │      │       │        │      │      ││
│  │ │Total     │R$352.008│R$152.78│R$199.2 │  57%  │ 43%  │ 3.883 │R$ 90,65│5.778 │R$ 60 ││
│  │ └──────────┴─────────┴────────┴────────┴───────┴─────────────┴──────────────┴──────│
│  │  DataTable + busca + badge de ruptura/estoque baixo + tendência ↗/↘ por linha         │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Componentes Vela mapeados para Produtos
| Widget | Componente existente | Gap / Novo |
|---|---|---|
| KPI row (4 cards) | `StatCard` + `Sparkline` | ✅ Reusa |
| Filtro período interno | markup de `DatePickersPage.tsx` | 🟡 Extrair → `DateRangePicker` (já decidido) |
| Filtro marca interno | estilo "Quick ranges" | 🟡 Criar `Segmented` (já decidido, trivial) |
| Filtro categoria | `Select` (`form.tsx`) / `Dropdown` | ✅ Reusa |
| Faturamento por Categoria | `BarChart` (+ `showValues`) | ✅ Reusa |
| Curva ABC de Categorias | `DonutChart` (participação A/B/C) + badges de resumo | ✅ Composição Vela |
| Top Linhas de Produto | `BarChart` (horizontal) | ✅ Reusa (+ `showValues`) |
| Top Produtos + ordenação | `BarChart` (horizontal) + `Segmented`/`Select` | ✅ Composição (+ `showValues`) |
| Tabela de Produtos | `DataTable` + busca (`Input`) + `Badge` + `Button` | ✅ Reusa |
| Dias de cobertura / estoque | `ProgressBar` + `Badge` danger | ✅ Composição |

### Perguntas de decisão que esta tela responde
1. **"Quais categorias/produtos puxam meu faturamento?"** → Faturamento por Categoria + Top Linhas + Top Produtos.
2. **"O que vende muito mas dá pouca margem (ou vice-versa)?"** → linha de % Margem sobreposta nas barras + coluna Margem/CMV% na tabela.
3. **"Estou prestes a perder venda por falta de estoque?"** → badge de ruptura + dias de cobertura na Tabela de Produtos.
4. **"Meu mix está concentrado demais em poucas categorias?"** → Curva ABC (Pareto 80/95) + Top Produtos.
5. **"Qual produto merece promoção / qual merece ser descontinuado?"** → tendência ↗/↘ por linha + margem + giro (itens vendidos).

### Grade responsiva — quantos cards por linha (Produtos)
Regra geral: **KPIs em 4 colunas no desktop**, widget central em largura total, par de rankings em 2 colunas, tabela em largura total. Mobile empilha tudo em 1 coluna. (Alinhado com Analytics/Ecommerce do Vela.)
| Bloco | Desktop (lg ≥1024px) | Tablet (md ≥768px) | Mobile (<768px) |
|---|---|---|---|
**Critério unificado (vale para TODAS as telas):** um card fica em **largura total** quando (a) tem muitas categorias no eixo horizontal, (b) é tabela com ≥5 colunas, ou (c) é o widget central da tela. Caso contrário, **agrupa em par de 2 colunas** no desktop. KPIs sempre em linha cheia (4 no desktop). Tablet = 2 KPIs/linha e cards 1/linha; Mobile = tudo 1/linha com scroll-x onde necessário.
| KPI row (4 StatCards) | **4 por linha** (`sm:grid-cols-2 lg:grid-cols-4`) | 2 por linha | 1 por linha |
| Faturamento por Categoria + Curva ABC | **2 por linha** (`lg:grid-cols-2`) — fat. absoluto × concentração Pareto | 1 por linha | 1 por linha (scroll-x) |
| Top Linhas + Top Produtos | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
| Tabela de Produtos | **1 por linha** (largura total — tabela ≥5 colunas, critério b) | 1 por linha | 1 por linha (scroll-x) |
> Tailwind: mesmo padrão dos dashboards Vela — `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` para KPIs; `lg:grid-cols-2` para o par Faturamento/ABC e o par de rankings; largura total para a tabela. Tabelas ganham `overflow-x-auto` no mobile.

### Glossário — termos de produtos (só os não óbvios)
| Termo no mock | O que significa, em linguagem simples |
|---|---|
| **Curva ABC / Pareto** | Ranking das categorias do maior para o menor faturamento, com % acumulado. Classe A = as que somam ~80% da receita; B = até ~95%; C = o resto. Concentração alta em A = risco se aquela categoria cair. |
| **CMV%** | Quanto do faturamento foi embora só pra comprar os produtos vendidos. CMV% 43% = de cada R$ 100 vendidos, R$ 43 foram o custo da mercadoria. Quanto menor, melhor a margem. |
| **T.M por Itens** | Ticket médio dividido pelos itens — valor médio de cada item dentro das compras. Ajuda a comparar com o Preço Médio (PA) e ver se o cliente leva itens baratos ou caros. |
| **Dias de cobertura** | Quantos dias o estoque atual aguenta no ritmo de venda de hoje. Baixo = risco de ficar sem o produto (ruptura). Alto = dinheiro parado em estoque. |
| **Ruptura** | Quando o produto acabou no estoque e a loja está perdendo venda por falta dele. Aparece como badge vermelho na tabela. |
| **Giro (itens vendidos)** | Quantidade de unidades vendidas no período. Produto com giro alto e margem boa = campeão. Giro alto e margem ruim = vende muito mas quase não lucra. |

---
## Mock ASCII — Tela VISÃO GERAL (Dashboard > Visão Geral)
> **Status:** PROPOSTA PARA VALIDAÇÃO — zero código escrito.
> **Foco:** a "capa" do dashboard — resumo executivo de TODA a operação numa tela só. O gestor bate o olho e sabe: vendi quanto, bati a meta, estou lucrando, e onde preciso agir. É o ponto de entrada; os detalhes vivem nas 4 subtelas (Equipe, Turnos, Financeiro, Produtos), acessíveis por drill-down.
> **Filtros internos:** Período (DateRangePicker — extrair de `DatePickersPage.tsx`) + Marca (Segmented WEPINK/WPINK).
> **Granularidade:** mesma regra (1 dia → HORA; >1 dia → DIA).
> **Nota:** 100% leitura analítica e consolidada. Zero CRUD. Cada card/KPI tem drill para a subtela correspondente.
> **Base:** imagem do "Dashboard Gerencial" enviada pelo gestor (Faturamento/CMV/Lucro Bruto/Vendas/Ticket Médio no topo; Categoria Meta×Fat; Dia da Semana Meta×Fat; % Atingido da Meta; Evolução Diária Fat×Meta; Faturamento por Forma de Pagamento).
### Extraído do BI atual (Dashboard Gerencial — imagem enviada)
| Bloco no BI | Como entra na nossa Visão Geral | Melhoria vs. BI |
|---|---|---|
| **KPIs do topo** (Faturamento R$152k c/ "8,20% Abaixo" da meta · CMV R$60k "CMV% 40%" · Lucro Bruto R$91k "60% de Margem" · Vendas 1.665 "2.495 itens · PA 1,50" · Ticket Médio R$91,30) | → vira os **4 KPIs financeiros** (padronizado): Faturamento · CMV · Lucro bruto · Ticket Médio. Cada um com delta vs meta/vs período anterior. "Vendas/itens" vira sub do card Faturamento. | Mantemos os 4 KPIs do padrão, mas agora são os 4 financeiros do BI (CMV e Ticket Médio sobem pra KPI próprio, como na referencia01 — são relevantes pro gestor bater o olho). "Meta do mês" desce pro widget central de Atingimento (onde já vivem as 3 metas). |
| **Top 3 Vendedoras** (ranking das 3 que mais venderam no período, com R$) | → card **Top 3 Vendedoras** (lista/BarChart horizontal compacto, `showValues`). | Responde "quem está puxando o resultado?". Drill → Equipe. (estava na referencia01, não pode faltar na capa) |
| **Top 3 Produtos** (ranking dos 3 produtos mais vendidos, com R$) | → card **Top 3 Produtos** (lista/BarChart horizontal compacto, `showValues`). | Responde "o que está vendendo mais?". Drill → Produtos. (estava na referencia01) |
| **Categoria - Meta Vs Faturamento** (barras BODY/PERF/HAIR/BATH/MAKE/SKIN: Meta cinza vs Realizado rosa, `80K/83K/64K...`) | → card **Faturamento por Categoria vs Meta** (StackedBarChart ou BarChart agrupado Meta×Realizado, `showValues`). | Clique numa categoria → drill para a tela Produtos filtrada. |
| **Dia da Semana - Meta Vs Faturamento** (barras horizontais por dia, Meta vs Realizado, `24K/20K/31K...`) | → card **Faturamento por Dia da Semana vs Meta** (BarChart horizontal agrupado, `showValues`). | Responde "qual dia da semana performa melhor?". Drill → Turnos. |
| **% Atingido da Meta de Faturamento** (3 gauges: Meta 79,68% R$190k · Super Meta 70,12% R$216k · Hiper Meta 58,43% R$260k) | → card **Atingimento da Meta** (3 Gauges: Meta / Super Meta / Hiper Meta, cada um com % e R$ alvo). | É o "termômetro" do mês. Já mapeado como `Gauge` (existe). |
| **Evolução Diária - Faturamento Vs Meta** (linha Realizado ACM + Meta ACM + Projeção tracejada; toggle "Vs Meta / Vs M-1") | → card **Evolução do Faturamento vs Meta** (AreaLineChart: realizado acumulado + meta acumulada + projeção; toggle Vs Meta / Vs Mês anterior). | A projeção responde "vou bater a meta até o fim do mês?". |
| **R$ Faturamento por Forma de Pagamento** (donut: Crédito 43% · Débito 26% · Pix · Dinheiro) | → card **Faturamento por Forma de Pagamento** (DonutChart). | Mesmo do Financeiro — aqui aparece como resumo. Drill → Financeiro. |
### Layout — Visão Geral
```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard > Visão Geral                                            │
│  [Período: Este mês ▾]  [Marca: WEPINK | WPINK]                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐│
│  │ Faturamentoⓘ │ │ CMV (custo)ⓘ │ │ Lucro        │ │ Ticket Médio ││
│  │              │ │ bruto      ⓘ │ │              │ │            ⓘ ││
│  │ R$ 152 mil   │ │ R$ 60 mil    │ │ R$ 91 mil    │ │ R$ 91,30     ││
│  │ ↘ 8,2% abaixo│ │ CMV% 40%     │ │ 60% de margem│ │ 1.665 vendas ││
│  │ da meta      │ │ ↗ +5% vs     │ │ ↗ +11% vs    │ │ 2.495 itens  ││
│  │ ▁▃▅▇▆▅▇█     │ │ mês passado  │ │ ▇▆▃▃▂▁     │ │ ▁▂▃▅▅▆▇     ││
│  │  [→ Financeiro]│ │[→ Financeiro]│ │ [→ Equipe]   │ │ [→ Produtos] ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘│
│   StatCard        StatCard        StatCard        StatCard          │
│   (cada KPI tem drill para a subtela correspondente)                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Atingimento da Meta ⓘ  (widget central — 3 Gauges)           │  │
│  │                                                               │  │
│  │   ╭───╮         ╭───╮         ╭───╮                          │  │
│  │  │79,7%│ Meta   │70,1%│ Super  │58,4%│ Hiper                  │  │
│  │   ╰───╯ R$190mil ╰─── R$216mil ───╯ R$260mil               │  │
│  │                                                               │  │
│  │  "Faltam R$ 38 mil pra bater a Meta do mês"                   │  │
│  │  Projeção: se manter o ritmo, fecha em ~R$ 188 mil (98%)      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Faturamento por Categoria   │ │ Faturamento por Dia da       │   │
│  │ vs Meta ⓘ                   │ │ Semana vs Meta ⓘ             │   │
│  │ (BarChart agrupado          │ │ (BarChart horizontal         │   │
│  │  Meta × Realizado)          │ │  agrupado Meta × Realizado)  │   │
│  │                             │ │                              │   │
│  │  BODY PERF HAIR BATH MAKE   │ │  dom  ██░░ 24K/20K           │   │
│  │  ░█   ░█   ░█  ...          │ │  seg  ██░░ 22K/15K           │   │
│  │ 80K  83K  64K ...           │ │  ter  ██░░ 31K/20K           │   │
│  │ (R$ direto em cada barra)   │ │  ...                         │   │
│  │ Legenda: ░ Meta  █ Realiz.  │ │  R$ direto em cada barra     │   │
│  │ Clique → drill p/ Produtos  │ │  Clique → drill p/ Turnos    │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Evolução do Faturamento     │ │ Faturamento por Forma de     │   │
│  │ vs Meta ⓘ                   │ │ Pagamento ⓘ  (DonutChart)    │   │
│  │ (AreaLineChart: realizado   │ │                              │   │
│  │  acum. + meta acum. +       │ │   ╭────╮  ● Crédito  43%     │   │
│  │  projeção tracejada)        │ │  │    │  ● Débito   26%     │   │
│  │  [Vs Meta] [Vs Mês ant.]    │ │  │    │  ● Pix      16%     │   │
│  │                             │ │   ╰────╯  ● Dinheiro 11%     │   │
│  │  ╱···········╮ ← meta acum. │ │         ● Outros    4%      │   │
│  │ ╱─────────── ··· ← projeção │ │  R$ e % por forma de pgto    │   │
│  │ ╱___________  ← realizado  │ │  Clique → drill p/ Financeiro│   │
│  │  R$ direto nos pontos       │ │                              │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────┐ ┌──────────────────────────────┐   │
│  │ Top 3 Vendedoras ⓘ          │ │ Top 3 Produtos ⓘ             │   │
│  │ (lista/BarChart horizontal  │ │ (lista/BarChart horizontal   │   │
│  │  compacto, showValues)      │ │  compacto, showValues)       │   │
│  │                             │ │                              │   │
│  │  1. Ana Silva    ████ R$ 24k│ │  1. Body Splash VF  ███ R$ 19k│  │
│  │  2. Carla Mendes ███  R$ 21k│ │  2. Desod Col VF    ██  R$ 12k│  │
│  │  3. Juliana Reis ██   R$ 18k│ │  3. Obsessed Perf   ██  R$ 11k│  │
│  │                             │ │                              │   │
│  │  R$ direto em cada barra    │ │  R$ direto em cada barra     │   │
│  │  Clique → drill p/ Equipe   │ │  Clique → drill p/ Produtos  │   │
│  └─────────────────────────────┘ └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```
### Componentes Vela mapeados para Visão Geral
| Widget | Componente existente | Gap / Novo |
|---|---|---|
| KPI row (4 cards) | `StatCard` + `Sparkline` | ✅ Reusa (cada um com link de drill) |
| Filtro período interno | markup de `DatePickersPage.tsx` | 🟡 Extrair → `DateRangePicker` (já decidido) |
| Filtro marca interno | estilo "Quick ranges" | 🟡 Criar `Segmented` (já decidido, trivial) |
| Atingimento da Meta (3 gauges) | `Gauge` | ✅ Reusa (3 instâncias) |
| Faturamento por Categoria vs Meta | `BarChart`/`StackedBarChart` (agrupado) | ✅ Composição (+ `showValues`) |
| Faturamento por Dia da Semana vs Meta | `BarChart` (horizontal, agrupado) | ✅ Composição (+ `showValues`) |
| Evolução do Faturamento vs Meta | `AreaLineChart` (3 séries: realizado/meta/projeção) + toggle | ✅ Composição (+ `showValues`) |
| Faturamento por Forma de Pagamento | `DonutChart` | ✅ Reusa |
| Top Vendedoras | Lista com avatar + `ProgressBar` (% da meta) + métricas (vendas · % da meta · T.M.) + link "Ver mais →" | ✅ Implementado — drill p/ Equipe (`/equipe`) |
| Top Produtos | `BarChart` (horizontal compacto) ou lista com `ProgressBar` | ✅ Composição (+ `showValues`) — drill p/ Produtos |
> **Nenhum componente novo além dos 3 já decididos** (`DateRangePicker`, `Segmented`, `CommissionLadder` — este último não entra aqui). Tudo é composição do que já existe no Vela.
### Perguntas de decisão que esta tela responde
1. **"Como está o mês num olhar só?"** → 4 KPIs + Atingimento da Meta (3 gauges) no topo.
2. **"Vou bater a meta até o fim do mês?"** → Evolução do Faturamento vs Meta com linha de projeção + "faltam R$ X".
3. **"Em que categoria/dia da semana estou ganhando ou perdendo pra meta?"** → os dois cards Meta × Realizado (Categoria e Dia da Semana).
4. **"Quem está puxando o resultado? O que está vendendo mais?"** → Top 3 Vendedoras (drill p/ Equipe) + Top 3 Produtos (drill p/ Produtos).
5. **"Onde vou clicar pra ver o detalhe?"** → cada KPI/card tem drill direto pra subtela (Financeiro, Equipe, Turnos, Produtos).
5. **"Como o cliente está pagando?"** → Forma de Pagamento (resumo do Financeiro).
### Grade responsiva — quantos cards por linha (Visão Geral)
**Critério unificado (vale para TODAS as telas):** um card fica em **largura total** quando (a) tem muitas categorias no eixo horizontal, (b) é tabela com ≥5 colunas, ou (c) é o widget central da tela. Caso contrário, **agrupa em par de 2 colunas** no desktop. KPIs sempre em linha cheia (4 no desktop). Tablet = 2 KPIs/linha e cards 1/linha; Mobile = tudo 1/linha com scroll-x onde necessário.
| Bloco | Desktop (lg ≥1024px) | Tablet (md ≥768px) | Mobile (<768px) |
|---|---|---|---|
| KPI row (4 StatCards) | **4 por linha** (`sm:grid-cols-2 lg:grid-cols-4`) | 2 por linha | 1 por linha |
| Atingimento da Meta (3 gauges) | **1 por linha** (largura total — widget central, critério c) | 1 por linha | 1 por linha |
| Categoria vs Meta + Dia da Semana vs Meta | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
| Evolução vs Meta + Forma de Pagamento | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
| Top 3 Vendedoras + Top 3 Produtos | **2 por linha** (`lg:grid-cols-2`) | 1 por linha | 1 por linha |
> Tailwind: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5` para os KPIs; `lg:grid-cols-2` para os três pares de gráficos (Categoria/Dia, Evolução/Forma Pgto, Top 3 Vendedoras/Top 3 Produtos); largura total (`lg:col-span-full`) para o widget central (Atingimento da Meta). Sem tabelas nesta tela, então sem scroll-x exceto em gráficos muito largos no mobile.
### Glossário — termos da Visão Geral (só os não óbvios)
| Termo no mock | O que significa, em linguagem simples |
|---|---|
| **Meta / Super Meta / Hiper Meta** | As 3 faixas de objetivo do mês. Meta = alvo básico; Super Meta = alvo esticado; Hiper Meta = alvo máximo. Cada uma tem seu R$ e seu % atingido. Bater a Meta já é bom; chegar na Hiper é excepcional. |
| **Projeção (linha tracejada)** | Estimativa de onde o faturamento vai chegar no fim do mês se o ritmo dos últimos dias se mantiver. Responde "vou bater a meta ou não?" antes do mês acabar. |
| **Realizado acumulado (ACM)** | Soma de tudo vendido desde o dia 1 até hoje. Comparado com a Meta acumulada (quanto deveria ter vendido até hoje), mostra se está adiantado ou atrasado no mês. |
| **PA (Preço Médio / Itens por venda)** | Aqui "PA 1,50" = em média 1,5 item por venda. Mostra se o cliente está levando mais ou menos produtos por compra. |
| **Drill-down (→ subtela)** | Clicar num KPI/card leva à tela de detalhe correspondente (Financeiro, Equipe, Turnos ou Produtos) já filtrada no mesmo período/marca. A Visão Geral é o resumo; o detalhe está lá. |

---

## PWA / deploy (2026-10-07)

- Sintoma: URL muda e a tela fica branca até F5. Causa típica: shell antigo (aba aberta ou SW) pede chunk com hash velho → 404; `React.lazy` rejeita e a rota não renderiza.
- Mitigação: `lazyPage` recarrega 1× em falha de import; SW (`public/sw.js` v9+) só grava respostas OK (não cacheia 404 de chunk); navegação continua network-first.

## Gestão Metas / Desafios — filtro de período (2026-10-07)

- No Dashboard, **Este mês** = mês até hoje (MTD, vendas). Na listagem de Metas/Desafios, **Este mês** usa o mês calendário inteiro (`managementScheduleWindow`), senão desafio/meta com início futuro some. Personalizado nessas telas também pode ir além de hoje.

## Desafios — regras na tela da vendedora (2026-10-07)

- Card Início > Desafios mostra bloco **Como funciona** (`sellerChallengeRules`): como ganha (disputa vs mínimo), o que conta (métrica + escopo), vendas mínimas / piso e prêmios do pódio. Linguagem direta para a pessoa na loja.

## Premissas de IMPLEMENTAÇÃO (ler antes de codar — decidido com o gestor)

> Estas regras valem para o início da fase de código. Não são mock — são decisões que evitam retrabalho.

### 1. O Dashboard atual será APAGADO
- Tudo que existe hoje em `src/pages/dashboards/` (Analytics/Sales/Ecommerce/Finance/CRM/BI/Logistics/Projects/SaaS etc.) é **template Vela de demonstração** — não é produto nosso.
- Na implementação, **substituímos** essas páginas pelas 5 telas mockadas (Visão Geral, Equipe, Turnos, Financeiro, Produtos). Não "adaptamos" o template por cima — construímos as nossas telas reusando os **componentes** do Vela (`src/components/ui` + `src/components/charts`), que são o que realmente aproveitamos.
- Os componentes Vela ficam; as páginas de demo saem.

### 2. Filtros de tela — rever antes de codar
- Cada subtela tem filtros internos (Período + Marca +, em Produtos, Categoria). Antes de implementar, **mapear quais filtros cada tela realmente precisa** e garantir que usem os componentes decididos:
  - Período → `DateRangePicker` (extrair de `src/pages/forms/DatePickersPage.tsx`).
  - Marca (WEPINK/WPINK) → `Segmented` (criar, estilo "Quick ranges").
  - Categoria / outros → `Select`/`Dropdown` (já existem).
- Os filtros devem alimentar um **escopo compartilhado** (hook `useEscopo` já previsto) para que drill-down entre telas preserve período/marca/loja.

### 3. Seletor de LOJA na barra superior (single-select + avatars) — ref: Select with avatars do Vela
- **Onde:** no header/topbar, **no lugar do campo de Pesquisa** do template Vela.
- **Comportamento:** selecionar **1 loja** ou **"Todas as lojas"** (single-select). Trigger: Avatar + fantasia + CNPJ; "Todas" sem avatar (ícone de loja + "Rede consolidada").
- **Componente:** `SeletorLoja` compõe `Avatar` + dropdown (padrão da SelectComponentsPage).
- **Escopo:** global via `useEscopo` (`filialIds: []` = todas; `[id]` = uma loja).
- **Dados:** lista de lojas vem de fixture/mock (`src/data/wedash/stores.ts`).

### 4. Ordem sugerida de construção (quando começar)
1. Componentes base que faltam: `DateRangePicker` (extrair), `Segmented` (criar), `CommissionLadder` (compor) + prop `showValues` nos charts.
2. Seletor de Loja no topbar (multi-select) + `useEscopo` compartilhado.
3. Subtelas na ordem: Financeiro → Produtos → Equipe → Turnos (mais componentes prontos primeiro).
4. Visão Geral por último (consolida as outras + drill-downs).