-- Faturamento por categoria usa o TOTALVENDA da margem quando a venda está lá
-- (o mesmo número da Lista). O preço do cupom / ConsultaDetMov fica só quando a
-- margem não trouxe o produto. Na 00386 o PRECO_TOTAL do detalhe vem nulo e o
-- agregado do cupom gravava R$ 0; a margem já tinha o valor certo.

create or replace view public.sales_category_day_view
with (security_invoker = true) as
with priced as (
  select
    p.tenant_id,
    p.store_id,
    p.day,
    p.item_count,
    coalesce(c.type_id, -2000000000)::bigint as category_id,
    coalesce(t.description, 'INDEFINIDO') as category_name,
    case
      when m.revenue_cents > 0
        and row_number() over (
          partition by p.tenant_id, p.store_id, p.day, p.product_code
          order by p.product_id
        ) = 1
      then m.revenue_cents
      when coalesce(m.revenue_cents, 0) > 0 then 0
      else p.revenue_cents
    end as revenue_cents
  from public.sales_product_day_agg p
  left join public.product_catalog c on c.erp_product_id = p.product_id
  left join public.product_type t on t.type_id = c.type_id
  left join public.sales_product_cost_day_agg m
    on m.tenant_id = p.tenant_id
   and m.store_id = p.store_id
   and m.day = p.day
   and p.product_code <> ''
   and m.product_code = p.product_code
)
select
  tenant_id,
  store_id,
  day,
  category_id,
  category_name,
  'ALL'::text as brand,
  sum(revenue_cents)::bigint as revenue_cents,
  sum(item_count)::int as item_count
from priced
group by tenant_id, store_id, day, category_id, category_name;

comment on view public.sales_category_day_view is
  'Faturamento diário por tipo: TOTALVENDA da margem quando existe; senão o preço do cupom/DetMov. Catálogo; fora dele = INDEFINIDO.';
