-- Link público do placar. O token não é o id da loja.
-- Quem tem o link lê só o placar daquela filial (sem comissão, sem o restante do app).

create table if not exists public.board_share (
  token uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, store_id)
);

alter table public.board_share enable row level security;

revoke all on public.board_share from public, anon, authenticated;
grant select, insert, update, delete on public.board_share to service_role;

create or replace function public.ensure_board_share(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_role text;
  v_stores uuid[];
  v_token uuid;
begin
  select m.tenant_id, m.role,
    coalesce((select array_agg(ms.store_id) from public.membership_store ms where ms.membership_id = m.id), '{}')
  into v_tenant, v_role, v_stores
  from public.membership m
  join public.identity i on i.id = m.identity_id
  where i.auth_user_id = auth.uid()
    and m.status = 'ACTIVE'
    and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
  order by m.is_owner desc
  limit 1;

  if v_tenant is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if not exists (select 1 from public.store s where s.id = p_store_id and s.tenant_id = v_tenant) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_role = 'MANAGER' and cardinality(v_stores) > 0 and not (p_store_id = any (v_stores)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  insert into public.board_share (tenant_id, store_id)
  values (v_tenant, p_store_id)
  on conflict (tenant_id, store_id) do update set created_at = public.board_share.created_at
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.ensure_board_share(uuid) from public, anon;
grant execute on function public.ensure_board_share(uuid) to authenticated, service_role;

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
  v_from date;
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
  v_from := v_today - 400;

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
      where d.tenant_id = v_tenant and d.store_id = v_store and d.day between v_from and v_today
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
      where d.tenant_id = v_tenant and d.store_id = v_store and d.day between v_from and v_today
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
        and g.starts_on <= v_today and g.ends_on >= v_from
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
        'manager_prize', c.manager_prize
      ))
      from public.challenge c
      where c.tenant_id = v_tenant and c.store_id = v_store
        and c.starts_on <= v_today and c.ends_on >= v_from
    ), '[]'::jsonb),
    'sellerProducts', coalesce((
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
      where p.tenant_id = v_tenant and p.store_id = v_store and p.day between v_from and v_today
    ), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object('code', cat.product_code, 'typeId', cat.type_id))
      from public.product_catalog cat
      where cat.product_code in (
        select distinct p.product_code
        from public.sales_seller_product_day_agg p
        where p.tenant_id = v_tenant and p.store_id = v_store and p.day between v_from and v_today
      )
    ), '[]'::jsonb),
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
