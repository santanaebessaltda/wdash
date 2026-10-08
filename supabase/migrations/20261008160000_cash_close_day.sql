-- Fechamento detalhado do Millennium: fundo, sangria, fechamento e valor digitado.
-- Uma linha por loja x dia x forma. Nao substitui o faturamento. Replace por loja x intervalo.
create table if not exists public.cash_close_day (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  payment_method text not null,
  account_id bigint not null,
  opening_cents bigint not null,
  sangria_cents bigint,
  closing_cents bigint not null,
  typed_cents bigint not null,
  primary key (tenant_id, store_id, day, payment_method)
);

create index if not exists cash_close_day_store_idx
  on public.cash_close_day (tenant_id, store_id, day);

comment on table public.cash_close_day is
  'Fechamento detalhado do Millennium (fundo, sangria, fechamento, valor digitado) por loja, dia e forma. O faturamento continua em sales_day_agg.';

alter table public.cash_close_day enable row level security;

grant select on public.cash_close_day to authenticated;
grant select, insert, update, delete on public.cash_close_day to service_role;

drop policy if exists cash_close_day_select_own on public.cash_close_day;
create policy cash_close_day_select_own
  on public.cash_close_day for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
