-- Desafio coletivo: a filial inteira contra um minimo. A venda sem vendedor entra.
-- O placar precisa do indice da filial e dos itens da loja quando o desafio e de produto.

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'challenge'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%mode in%'
  loop
    execute format('alter table public.challenge drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.challenge
  add constraint challenge_mode_check check (mode in ('CONTEST', 'MINIMUM', 'COLLECTIVE'));

create or replace function public.read_board_share(p_token uuid, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_store uuid;
  v_tz text;
  v_today date;
  v_clock date;
  v_month date;
  v_seller_from date;
  v_day_from date;
  v_items boolean;
  v_types boolean;
begin
  select b.tenant_id, b.store_id, coalesce(nullif(s.timezone, ''), 'America/Campo_Grande')
  into v_tenant, v_store, v_tz
  from public.board_share b
  join public.store s on s.id = b.store_id
  where b.token = p_token;

  if v_tenant is null then
    return null;
  end if;

  v_clock := (now() at time zone v_tz)::date;
  v_today := coalesce(p_today, v_clock);
  if v_today < v_clock - 1 or v_today > v_clock + 1 then
    v_today := v_clock;
  end if;
  v_month := date_trunc('month', v_today)::date;

  select least(v_month, coalesce(min(g.starts_on), v_month))
  into v_seller_from
  from public.goal g
  where g.tenant_id = v_tenant and g.store_id = v_store
    and g.starts_on <= v_today and g.ends_on >= v_today;

  select least(
    v_seller_from,
    coalesce(min(
      case
        when c.metric = 'INDEX' and (c.mode = 'COLLECTIVE' or c.manager_prize is not null or c.cashier_prize is not null)
          then c.starts_on - ((c.ends_on - c.starts_on) + 1)
        else c.starts_on
      end
    ), v_seller_from)
  )
  into v_seller_from
  from public.challenge c
  where c.tenant_id = v_tenant and c.store_id = v_store
    and c.starts_on <= v_today and c.ends_on >= v_today;

  select least(v_seller_from, coalesce(min(g.starts_on) - 42, v_seller_from))
  into v_day_from
  from public.goal g
  where g.tenant_id = v_tenant and g.store_id = v_store
    and g.starts_on <= v_today and g.ends_on >= v_today;

  select exists (
    select 1 from public.challenge c
    where c.tenant_id = v_tenant and c.store_id = v_store
      and c.starts_on <= v_today and c.ends_on >= v_today
      and c.metric in ('QUANTITY', 'VALUE')
      and c.scope is distinct from 'ALL'
  ) into v_items;

  select exists (
    select 1 from public.challenge c
    where c.tenant_id = v_tenant and c.store_id = v_store
      and c.starts_on <= v_today and c.ends_on >= v_today
      and c.metric in ('QUANTITY', 'VALUE')
      and c.scope = 'CATEGORIES'
  ) into v_types;

  return jsonb_build_object(
    'store', (
      select jsonb_build_object(
        'id', s.id,
        'tradeName', coalesce(nullif(trim(s.trade_name), ''), s.name, 'Filial'),
        'hours', s.hours,
        'timezone', v_tz,
        'code', s.code,
        'millenniumStoreId', s.millennium_store_id
      )
      from public.store s
      where s.id = v_store
    ),
    'watermark', (
      select e.last_light_sync_at
      from public.erp_credential e
      where e.tenant_id = v_tenant
        and (
          e.id = (select s.credential_id from public.store s where s.id = v_store)
          or (select s.credential_id from public.store s where s.id = v_store) is null
        )
      order by e.last_light_sync_at desc nulls last
      limit 1
    ),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant_id', d.tenant_id,
        'store_id', d.store_id,
        'day', d.day,
        'brand', d.brand,
        'revenue_cents', d.revenue_cents,
        'sales_count', d.sales_count,
        'item_count', d.item_count,
        'cmv_cents', d.cmv_cents
      ))
      from public.sales_day_agg d
      where d.tenant_id = v_tenant and d.store_id = v_store and d.day between v_day_from and v_today
    ), '[]'::jsonb),
    'sellerDays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant_id', d.tenant_id,
        'store_id', d.store_id,
        'day', d.day,
        'seller_key', d.seller_key,
        'seller_name', d.seller_name,
        'seller_employee_id', d.seller_employee_id,
        'seller_gerador_id', d.seller_gerador_id,
        'brand', d.brand,
        'revenue_cents', d.revenue_cents,
        'sales_count', d.sales_count,
        'item_count', d.item_count
      ))
      from public.sales_seller_day_agg d
      where d.tenant_id = v_tenant and d.store_id = v_store and d.day between v_seller_from and v_today
    ), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'store_id', s.store_id,
        'code', s.code,
        'millennium_employee_id', s.millennium_employee_id,
        'millennium_gerador_id', s.millennium_gerador_id,
        'name', s.name,
        'name_keys', coalesce(s.name_keys, '{}'::text[]),
        'active', s.active,
        'erp_role', s.erp_role,
        'admitted_on', s.admitted_on,
        'departed_on', s.departed_on,
        'shift_id', s.shift_id,
        'shift_name', sh.name,
        'shift_start', sh.start_time,
        'shift_end', sh.end_time
      ))
      from public.store_seller s
      left join public.store_shift sh on sh.id = s.shift_id
      where s.tenant_id = v_tenant and s.store_id = v_store
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'store_id', g.store_id,
        'name', g.name,
        'starts_on', g.starts_on,
        'ends_on', g.ends_on,
        'target_cents', g.target_cents,
        'tier_mode', g.tier_mode,
        'tiers', g.tiers,
        'groups', g.groups,
        'spread_unidentified', g.spread_unidentified
      ))
      from public.goal g
      where g.tenant_id = v_tenant and g.store_id = v_store
        and g.starts_on <= v_today and g.ends_on >= v_today
    ), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'store_id', c.store_id,
        'name', c.name,
        'starts_on', c.starts_on,
        'ends_on', c.ends_on,
        'metric', c.metric,
        'scope', c.scope,
        'mode', c.mode,
        'products', c.products,
        'categories', c.categories,
        'target', c.target,
        'min_sales', c.min_sales,
        'prizes', c.prizes,
        'manager_prize', c.manager_prize,
        'cashier_prize', c.cashier_prize
      ))
      from public.challenge c
      where c.tenant_id = v_tenant and c.store_id = v_store
        and c.starts_on <= v_today and c.ends_on >= v_today
    ), '[]'::jsonb),
    'storeProducts', case when not v_items then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenantId', p.tenant_id,
        'storeId', p.store_id,
        'day', p.day,
        'productId', p.product_id,
        'productCode', p.product_code,
        'productName', p.product_name,
        'brand', p.brand,
        'revenueCents', p.revenue_cents,
        'itemCount', p.item_count
      ))
      from public.sales_product_day_agg p
      where p.tenant_id = v_tenant and p.store_id = v_store
        and p.day between v_seller_from and v_today
    ), '[]'::jsonb) end,
    'sellerProducts', case when not v_items then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenantId', p.tenant_id,
        'storeId', p.store_id,
        'day', p.day,
        'sellerGeneratorId', p.seller_gerador_id,
        'sellerKey', p.seller_key,
        'sellerName', p.seller_name,
        'productCode', p.product_code,
        'productId', p.product_id,
        'itemCount', p.item_count,
        'revenueCents', p.revenue_cents
      ))
      from public.sales_seller_product_day_agg p
      where p.tenant_id = v_tenant and p.store_id = v_store
        and p.day between v_seller_from and v_today
        and exists (
          select 1 from public.challenge c
          where c.tenant_id = p.tenant_id and c.store_id = p.store_id
            and c.starts_on <= v_today and c.ends_on >= v_today
            and c.metric in ('QUANTITY', 'VALUE')
            and c.scope is distinct from 'ALL'
            and p.day between c.starts_on and least(c.ends_on, v_today)
        )
    ), '[]'::jsonb) end,
    'catalog', case when not v_types then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('code', cat.product_code, 'typeId', cat.type_id))
      from public.product_catalog cat
      where cat.product_code in (
        select distinct p.product_code
        from public.sales_seller_product_day_agg p
        where p.tenant_id = v_tenant and p.store_id = v_store
          and p.day between v_seller_from and v_today
          and exists (
            select 1 from public.challenge c
            where c.tenant_id = p.tenant_id and c.store_id = p.store_id
              and c.starts_on <= v_today and c.ends_on >= v_today
              and c.metric in ('QUANTITY', 'VALUE')
              and c.scope = 'CATEGORIES'
              and p.day between c.starts_on and least(c.ends_on, v_today)
          )
      )
    ), '[]'::jsonb) end,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId', m.id,
        'storeId', s.store_id,
        'employeeId', s.millennium_employee_id,
        'generatorId', s.millennium_gerador_id,
        'nameKeys', coalesce(s.name_keys, '{}'::text[]),
        'avatarUrl', i.avatar_url
      ))
      from public.store_seller s
      join public.membership m on m.id = s.membership_id
      join public.identity i on i.id = m.identity_id
      where s.tenant_id = v_tenant
        and s.store_id = v_store
        and i.avatar_url is not null
        and i.avatar_url <> ''
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_board_share(uuid, date) from public;
grant execute on function public.read_board_share(uuid, date) to anon, authenticated, service_role;
