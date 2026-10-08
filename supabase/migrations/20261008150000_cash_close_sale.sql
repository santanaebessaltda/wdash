-- Venda individual da Lista para o fechamento de caixa (valor, forma, vendedor, hora).
-- Nao substitui sales_payment_day_agg nem o faturamento. Replace por loja x intervalo.
create table if not exists public.cash_close_sale (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  operation_code text not null,
  day date not null,
  occurred_at timestamptz not null,
  payment_method text not null,
  revenue_cents bigint not null,
  seller_name text not null default '',
  seller_gerador_id bigint,
  primary key (tenant_id, store_id, operation_code, payment_method)
);

create index if not exists cash_close_sale_day_idx
  on public.cash_close_sale (tenant_id, store_id, day);

comment on table public.cash_close_sale is
  'Cada venda da VENDAS.Lista (valor, forma, vendedor, hora) para o fechamento de caixa. O agregado diario de formas continua em sales_payment_day_agg.';

alter table public.cash_close_sale enable row level security;

grant select on public.cash_close_sale to authenticated;
grant select, insert, update, delete on public.cash_close_sale to service_role;

drop policy if exists cash_close_sale_select_own on public.cash_close_sale;
create policy cash_close_sale_select_own
  on public.cash_close_sale for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
