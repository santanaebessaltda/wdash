-- Totais por SKU no periodo (1 linha por loja/produto), para Top produtos / Visao geral
-- sem baixar dezenas de milhares de linhas produto x dia.

create or replace function public.read_sales_product_period_aggs(
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

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.store_id, r.product_id), '[]'::jsonb)
  into v_out
  from (
    select
      tenant_id,
      store_id,
      p_from as day,
      product_id,
      max(product_code) as product_code,
      (array_agg(product_name order by day desc))[1] as product_name,
      brand,
      sum(revenue_cents)::bigint as revenue_cents,
      sum(item_count)::int as item_count
    from public.sales_product_day_agg
    where tenant_id = p_tenant_id
      and day >= p_from
      and day <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
    group by tenant_id, store_id, product_id, brand
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_product_period_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_product_period_aggs(uuid, uuid[], date, date) to authenticated, service_role;

create or replace function public.read_sales_product_cost_period_aggs(
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

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.store_id, r.product_code), '[]'::jsonb)
  into v_out
  from (
    select
      tenant_id,
      store_id,
      p_from as day,
      product_code,
      sum(item_count)::int as item_count,
      sum(revenue_cents)::bigint as revenue_cents,
      sum(cmv_cents)::bigint as cmv_cents
    from public.sales_product_cost_day_agg
    where tenant_id = p_tenant_id
      and day >= p_from
      and day <= p_to
      and (
        p_store_ids is null
        or cardinality(p_store_ids) = 0
        or store_id = any (p_store_ids)
      )
    group by tenant_id, store_id, product_code
  ) r;

  return v_out;
end;
$$;

revoke all on function public.read_sales_product_cost_period_aggs(uuid, uuid[], date, date) from public, anon;
grant execute on function public.read_sales_product_cost_period_aggs(uuid, uuid[], date, date) to authenticated, service_role;
