-- Falta do dia na sangria: dinheiro que saiu no lançamento e não estava no caixa.
-- A sincronização do Millennium não mexe nesta tabela.

create table if not exists public.sangria_shortage (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  amount_cents bigint not null check (amount_cents > 0),
  note text not null default '',
  primary key (store_id, day)
);

comment on table public.sangria_shortage is
  'Falta do dia. Sai do boleto. A justificativa fica em note. A busca do Millennium não altera esta linha.';

alter table public.sangria_shortage enable row level security;

grant select, insert, update, delete on public.sangria_shortage to authenticated;
grant select, insert, update, delete on public.sangria_shortage to service_role;

create policy sangria_shortage_select on public.sangria_shortage for select to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create policy sangria_shortage_insert on public.sangria_shortage for insert to authenticated
  with check (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_shortage.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

create policy sangria_shortage_update on public.sangria_shortage for update to authenticated
  using (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_shortage.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  )
  with check (tenant_id in (select public.staff_tenant_ids()));

create policy sangria_shortage_delete on public.sangria_shortage for delete to authenticated
  using (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_shortage.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );
