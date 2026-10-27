-- Leitura rapida de produto/custo no periodo (1 round-trip em jsonb) + rollup mensal.
-- O PostgREST corta select em 1000 linhas; jsonb numa funcao devolve o periodo inteiro.

-- ---------- Rollup mensal (worker grava; leitura futura / backup) ----------

create table if not exists public.sales_product_month_agg (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  month_start date not null,
  product_id int not null,
  product_code text not null default '',
  product_name text not null,
  brand text not null default 'ALL'
    check (brand in ('WEPINK', 'WPINK', 'ALL')),
  revenue_cents bigint not null default 0,
  item_count int not null default 0,
  primary key (tenant_id, store_id, month_start, product_id)
);

create index if not exists sales_product_month_agg_scope_idx
  on public.sales_product_month_agg (tenant_id, month_start);

comment on table public.sales_product_month_agg is
  'Receita mensal por SKU, somada de sales_product_day_agg. O worker reconstrói o mês ao gravar o dia.';

alter table public.sales_product_month_agg enable row level security;

grant select on public.sales_product_month_agg to authenticated;
grant select, insert, update, delete on public.sales_product_month_agg to service_role;

create policy sales_product_month_agg_select_own
  on public.sales_product_month_agg for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create table if not exists public.sales_product_cost_month_agg (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  month_start date not null,
  product_code text not null,
  item_count int not null default 0,
  revenue_cents bigint not null default 0,
  cmv_cents bigint not null default 0,
  primary key (tenant_id, store_id, month_start, product_code)
);

create index if not exists sales_product_cost_month_agg_scope_idx
  on public.sales_product_cost_month_agg (tenant_id, month_start);

comment on table public.sales_product_cost_month_agg is
  'CMV mensal por COD_PRODUTO, somado de sales_product_cost_day_agg.';

alter table public.sales_product_cost_month_agg enable row level security;

grant select on public.sales_product_cost_month_agg to authenticated;
grant select, insert, update, delete on public.sales_product_cost_month_agg to service_role;

create policy sales_product_cost_month_agg_select_own
  on public.sales_product_cost_month_agg for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

-- Reconstroi o mes a partir dos dias (service_role / worker).
create or replace function public.rebuild_sales_product_month(
  p_tenant_id uuid,
  p_store_id uuid,
  p_month_start date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month_start)::date;
  v_month_end date := (v_month + interval '1 month' - interval '1 day')::date;
begin
  delete from public.sales_product_month_agg
  where tenant_id = p_tenant_id
    and store_id = p_store_id
    and month_start = v_month;

  insert into public.sales_product_month_agg (
    tenant_id, store_id, month_start, product_id, product_code, product_name, brand, revenue_cents, item_count
  )
  select
    tenant_id,
    store_id,
    v_month,
    product_id,
    max(product_code),
    (array_agg(product_name order by day desc))[1],
    brand,
    sum(revenue_cents)::bigint,
    sum(item_count)::int
  from public.sales_product_day_agg
  where tenant_id = p_tenant_id
    and store_id = p_store_id
    and day >= v_month
    and day <= v_month_end
  group by tenant_id, store_id, product_id, brand;

  delete from public.sales_product_cost_month_agg
  where tenant_id = p_tenant_id
    and store_id = p_store_id
    and month_start = v_month;

  insert into public.sales_product_cost_month_agg (
    tenant_id, store_id, month_start, product_code, item_count, revenue_cents, cmv_cents
  )
  select
    tenant_id,
    store_id,
    v_month,
    product_code,
    sum(item_count)::int,
    sum(revenue_cents)::bigint,
    sum(cmv_cents)::bigint
  from public.sales_product_cost_day_agg
  where tenant_id = p_tenant_id
    and store_id = p_store_id
    and day >= v_month
    and day <= v_month_end
  group by tenant_id, store_id, product_code;
end;
$$;

revoke all on function public.rebuild_sales_product_month(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.rebuild_sales_product_month(uuid, uuid, date) to service_role;

-- ---------- Leitura em 1 request (jsonb) ----------

create or replace function public.read_sales_product_day_aggs(
  p_tenant_id uuid,
  p_store_ids uuid[],
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if p_tenant_id is null or p_from is null or p_to is null then
    return '[]'::jsonb;
  end if;
  if not exists (select 1 from public.staff_tenant_ids() t where t = p_tenant_id) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.day, r.store_id, r.product_id), '[]'::jsonb)
  into v_out
  from (
    select
      tenant_id,
      store_id,
      day,
      product_id,
      product_code,
      product_name,
      brand,
      revenue_cents,
      item_count
    from public.sales_product_day_agg
    where tenant_id = p_tenant_id
      and day >= p_from
      and day <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_product_day_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_product_day_aggs(uuid, uuid[], date, date) to authenticated, service_role;

create or replace function public.read_sales_product_cost_day_aggs(
  p_tenant_id uuid,
  p_store_ids uuid[],
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if p_tenant_id is null or p_from is null or p_to is null then
    return '[]'::jsonb;
  end if;
  if not exists (select 1 from public.staff_tenant_ids() t where t = p_tenant_id) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.day, r.store_id, r.product_code), '[]'::jsonb)
  into v_out
  from (
    select
      tenant_id,
      store_id,
      day,
      product_code,
      item_count,
      revenue_cents,
      cmv_cents
    from public.sales_product_cost_day_agg
    where tenant_id = p_tenant_id
      and day >= p_from
      and day <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_product_cost_day_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_product_cost_day_aggs(uuid, uuid[], date, date) to authenticated, service_role;

create or replace function public.read_sales_seller_day_aggs(
  p_tenant_id uuid,
  p_store_ids uuid[],
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if p_tenant_id is null or p_from is null or p_to is null then
    return '[]'::jsonb;
  end if;
  if not exists (select 1 from public.staff_tenant_ids() t where t = p_tenant_id) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.day, r.store_id, r.seller_key), '[]'::jsonb)
  into v_out
  from (
    select
      tenant_id,
      store_id,
      day,
      seller_key,
      seller_name,
      brand,
      revenue_cents,
      sales_count,
      item_count,
      seller_employee_id,
      seller_gerador_id
    from public.sales_seller_day_agg
    where tenant_id = p_tenant_id
      and day >= p_from
      and day <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_seller_day_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_seller_day_aggs(uuid, uuid[], date, date) to authenticated, service_role;
