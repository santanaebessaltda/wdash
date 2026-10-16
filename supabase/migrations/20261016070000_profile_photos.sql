-- Foto de perfil de quem pode entrar na WDash e trocar a própria foto.
-- Vendedor ligado a uma conta e gestor/gerente. A identity continua só da própria pessoa;
-- esta função devolve só a URL pública. Qualquer membro ativo da empresa lê (o vendedor vê o pódio).

create or replace function public.profile_photos(p_tenant_id uuid)
returns table (
  membership_id uuid,
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
    m.id,
    s.store_id,
    s.millennium_employee_id,
    s.millennium_gerador_id,
    s.name_keys,
    i.avatar_url
  from public.store_seller s
  join public.membership m on m.id = s.membership_id
  join public.identity i on i.id = m.identity_id
  where s.tenant_id = p_tenant_id
    and exists (
      select 1
      from public.membership me
      join public.identity ie on ie.id = me.identity_id
      where ie.auth_user_id = auth.uid()
        and me.tenant_id = p_tenant_id
        and me.status = 'ACTIVE'
    )
    and i.avatar_url is not null
    and i.avatar_url <> ''
  union all
  select
    m.id,
    null::uuid,
    null::int,
    null::int,
    '{}'::text[],
    i.avatar_url
  from public.membership m
  join public.identity i on i.id = m.identity_id
  where m.tenant_id = p_tenant_id
    and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    and exists (
      select 1
      from public.membership me
      join public.identity ie on ie.id = me.identity_id
      where ie.auth_user_id = auth.uid()
        and me.tenant_id = p_tenant_id
        and me.status = 'ACTIVE'
    )
    and i.avatar_url is not null
    and i.avatar_url <> '';
$$;

revoke all on function public.profile_photos(uuid) from public, anon;
grant execute on function public.profile_photos(uuid) to authenticated, service_role;
