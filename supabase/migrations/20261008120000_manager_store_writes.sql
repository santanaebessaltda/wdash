-- Gerente com lojas vinculadas só escreve nessas lojas.
-- Sem vínculo = todas (mesma regra do enqueue e de store_purchase_min).
-- Gestor (OWNER / ADMIN_GLOBAL) continua em qualquer loja do tenant.

create or replace function public.staff_can_write_store(p_tenant uuid, p_store uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.membership m
    join public.identity i on i.id = m.identity_id
    where i.auth_user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.tenant_id = p_tenant
      and (
        m.role in ('OWNER', 'ADMIN_GLOBAL')
        or (
          m.role = 'MANAGER'
          and (
            not exists (
              select 1 from public.membership_store ms where ms.membership_id = m.id
            )
            or exists (
              select 1
              from public.membership_store ms
              where ms.membership_id = m.id
                and ms.store_id = p_store::text
            )
          )
        )
      )
  );
$$;

revoke all on function public.staff_can_write_store(uuid, uuid) from public, anon;
grant execute on function public.staff_can_write_store(uuid, uuid) to authenticated, service_role;

drop policy if exists goal_write_managers on public.goal;
create policy goal_write_managers
  on public.goal for all
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists challenge_write_managers on public.challenge;
create policy challenge_write_managers
  on public.challenge for all
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists store_shift_write_managers on public.store_shift;
create policy store_shift_write_managers
  on public.store_shift for all
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists store_update_own on public.store;
create policy store_update_own
  on public.store for update
  to authenticated
  using (public.staff_can_write_store(tenant_id, id))
  with check (public.staff_can_write_store(tenant_id, id));

drop policy if exists store_seller_update_shift on public.store_seller;
create policy store_seller_update_shift
  on public.store_seller for update
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists store_seller_update_central on public.store_seller;
create policy store_seller_update_central
  on public.store_seller for update
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));
