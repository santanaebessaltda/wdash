-- Proximo passo: leitura pelo rollup mensal quando o periodo e feito so de meses civis
-- completos (dia 1  ->  ultimo dia). Mes parcial continua no dia a dia (comparativo ate hoje).

-- Backfill a partir dos dias ja gravados (uma vez).
insert into public.sales_product_month_agg (
  tenant_id, store_id, month_start, product_id, product_code, product_name, brand, revenue_cents, item_count
)
select
  tenant_id,
  store_id,
  date_trunc('month', day)::date,
  product_id,
  max(product_code),
  (array_agg(product_name order by day desc))[1],
  brand,
  sum(revenue_cents)::bigint,
  sum(item_count)::int
from public.sales_product_day_agg
group by tenant_id, store_id, date_trunc('month', day)::date, product_id, brand
on conflict (tenant_id, store_id, month_start, product_id) do update
set
  product_code = excluded.product_code,
  product_name = excluded.product_name,
  brand = excluded.brand,
  revenue_cents = excluded.revenue_cents,
  item_count = excluded.item_count;

insert into public.sales_product_cost_month_agg (
  tenant_id, store_id, month_start, product_code, item_count, revenue_cents, cmv_cents
)
select
  tenant_id,
  store_id,
  date_trunc('month', day)::date,
  product_code,
  sum(item_count)::int,
  sum(revenue_cents)::bigint,
  sum(cmv_cents)::bigint
from public.sales_product_cost_day_agg
group by tenant_id, store_id, date_trunc('month', day)::date, product_code
on conflict (tenant_id, store_id, month_start, product_code) do update
set
  item_count = excluded.item_count,
  revenue_cents = excluded.revenue_cents,
  cmv_cents = excluded.cmv_cents;

-- Leitura mensal (mesmo shape do dia, com day = month_start) para o client reaproveitar o build.
create or replace function public.read_sales_product_month_aggs(
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
      month_start as day,
      product_id,
      product_code,
      product_name,
      brand,
      revenue_cents,
      item_count
    from public.sales_product_month_agg
    where tenant_id = p_tenant_id
      and month_start >= p_from
      and month_start <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_product_month_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_product_month_aggs(uuid, uuid[], date, date) to authenticated, service_role;

create or replace function public.read_sales_product_cost_month_aggs(
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
      month_start as day,
      product_code,
      item_count,
      revenue_cents,
      cmv_cents
    from public.sales_product_cost_month_agg
    where tenant_id = p_tenant_id
      and month_start >= p_from
      and month_start <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_product_cost_month_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_product_cost_month_aggs(uuid, uuid[], date, date) to authenticated, service_role;
