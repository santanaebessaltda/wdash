-- Nomes de gestor e gerente ativos para a retirada de funcionário.
-- A identity continua só da própria pessoa. Quem fecha o caixa (gestor ou gerente) lê só o nome.

create or replace function public.withdrawal_staff(p_tenant_id uuid)
returns table (
  id uuid,
  name text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, i.name
  from public.membership m
  join public.identity i on i.id = m.identity_id
  where m.tenant_id = p_tenant_id
    and m.role in ('OWNER', 'MANAGER')
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
    );
$$;

revoke all on function public.withdrawal_staff(uuid) from public, anon;
grant execute on function public.withdrawal_staff(uuid) to authenticated, service_role;
