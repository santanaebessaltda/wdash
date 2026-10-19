-- Usuário da filial é uma escolha da WDash. Sem escolha, continua quem tem o código da filial.
-- A meta pode ratear só a venda sem vendedor identificado (padrão: não rateia).

alter table public.store
  add column if not exists branch_user_seller_id uuid references public.store_seller (id) on delete set null,
  add column if not exists branch_user_chosen boolean not null default false;

comment on column public.store.branch_user_seller_id is
  'Pessoa escolhida como usuário da filial. Vale quando branch_user_chosen é true.';

comment on column public.store.branch_user_chosen is
  'false = usuário da filial é quem tem o código da filial. true = vale branch_user_seller_id, e null nesse campo significa nenhum.';

grant update (branch_user_seller_id, branch_user_chosen) on public.store to authenticated;

alter table public.goal
  add column if not exists spread_unidentified boolean not null default false;

comment on column public.goal.spread_unidentified is
  'Individual e Grupo: rateia a venda sem vendedor identificado igualmente entre os vendedores presentes no dia. Usuário da filial e gerência ficam de fora. O modo Geral ignora.';
