-- Gerentes ativas da empresa, com as filiais em que entram na carteira.
-- store_ids vazio = gerente de todas as filiais. Sem e-mail: a carteira só precisa do nome.

create or replace function public.wallet_managers(p_tenant_id uuid)
returns table (
  id uuid,
  name text,
  store_ids text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    i.name,
    coalesce(
      array_agg(ms.store_id) filter (where ms.store_id is not null),
      '{}'::text[]
    )
  from public.membership m
  join public.identity i on i.id = m.identity_id
  left join public.membership_store ms on ms.membership_id = m.id
  where m.tenant_id = p_tenant_id
    and m.role = 'MANAGER'
    and m.status = 'ACTIVE'
    and length(trim(i.name)) > 0
    and exists (
      select 1
      from public.membership me
      join public.identity ie on ie.id = me.identity_id
      where ie.auth_user_id = auth.uid()
        and me.tenant_id = p_tenant_id
        and me.status = 'ACTIVE'
        and me.role in ('OWNER', 'ADMIN_GLOBAL', 'MANAGER')
    )
  group by m.id, i.name;
$$;

revoke all on function public.wallet_managers(uuid) from public, anon;
grant execute on function public.wallet_managers(uuid) to authenticated, service_role;
