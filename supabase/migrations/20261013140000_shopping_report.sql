-- Acesso do painel do shopping por filial e os dias que o painel aceitou.
-- A senha cifrada fica só no service_role. A tela lê URL, usuário e administradora.

create table if not exists public.store_shopping (
  store_id uuid primary key references public.store (id) on delete cascade,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  administrator text not null check (administrator in ('allos', 'argo')),
  base_url text not null,
  username text not null,
  secret_ciphertext text not null,
  last_run_at timestamptz,
  last_error text not null default '',
  constraint store_shopping_url_trim check (length(btrim(base_url)) > 0),
  constraint store_shopping_user_trim check (length(btrim(username)) > 0)
);

comment on table public.store_shopping is
  'Painel do shopping desta filial. A senha não volta para a tela.';
comment on column public.store_shopping.secret_ciphertext is
  'Senha do painel, cifrada. A tela não lê esta coluna.';

create table if not exists public.shopping_day (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  launched_cents bigint not null,
  primary key (store_id, day)
);

comment on table public.shopping_day is
  'Dia aceito na linha Informada. Sem linha, o dia ainda não foi lançado.';

alter table public.store_shopping enable row level security;
alter table public.shopping_day enable row level security;

grant select (store_id, tenant_id, administrator, base_url, username, last_run_at, last_error) on public.store_shopping to authenticated;
grant select, insert, update, delete on public.store_shopping to service_role;
grant select on public.shopping_day to authenticated;
grant select, insert, update, delete on public.shopping_day to service_role;

create policy store_shopping_select on public.store_shopping for select to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create policy shopping_day_select on public.shopping_day for select to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
