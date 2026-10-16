-- Foto de perfil do vendedor (identity.avatar_url) para o gestor/gerente.
-- A identity só é lida pela própria pessoa; esta função devolve só a URL pública da foto.

create or replace function public.seller_avatar_urls(p_tenant_id uuid)
returns table (
  store_id uuid,
  employee_id int,
  generator_id int,
  name_keys text[],
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.store_id,
    s.millennium_employee_id,
    s.millennium_gerador_id,
    s.name_keys,
    i.avatar_url
  from public.store_seller s
  join public.membership m on m.id = s.membership_id
  join public.identity i on i.id = m.identity_id
  where s.tenant_id = p_tenant_id
    and p_tenant_id in (select public.staff_tenant_ids())
    and i.avatar_url is not null
    and i.avatar_url <> '';
$$;

revoke all on function public.seller_avatar_urls(uuid) from public, anon;
grant execute on function public.seller_avatar_urls(uuid) to authenticated, service_role;
