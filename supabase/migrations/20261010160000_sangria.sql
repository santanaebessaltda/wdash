-- Sangrias do Millennium (LANCAMENTOS.Lista) e o depósito que a pessoa fecha no calendário.
-- A busca atualiza valor e observação do ERP. A marca depósito/compra e o texto editado ficam.

create table if not exists public.sangria_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  erp_lancamento bigint not null,
  day date not null,
  amount_cents bigint not null,
  document text not null default '',
  erp_note text not null default '',
  note text not null default '',
  kind text not null default 'deposit' check (kind in ('deposit', 'purchase')),
  unique (tenant_id, erp_lancamento)
);

create index if not exists sangria_line_store_day on public.sangria_line (store_id, day);

comment on table public.sangria_line is
  'Lançamento de sangria. kind deposit entra no boleto; purchase é a compra (faltando).';

create table if not exists public.sangria_deposit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.sangria_deposit_day (
  deposit_id uuid not null references public.sangria_deposit (id) on delete cascade,
  tenant_id uuid not null,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  primary key (store_id, day)
);

comment on table public.sangria_deposit_day is
  'Cada dia entra em um depósito só. O valor do depósito é o boleto desses dias.';

alter table public.sangria_line enable row level security;
alter table public.sangria_deposit enable row level security;
alter table public.sangria_deposit_day enable row level security;

grant select, update on public.sangria_line to authenticated;
grant select, insert, update, delete on public.sangria_line to service_role;
grant select, insert, delete on public.sangria_deposit to authenticated;
grant select, insert, update, delete on public.sangria_deposit to service_role;
grant select, insert, delete on public.sangria_deposit_day to authenticated;
grant select, insert, update, delete on public.sangria_deposit_day to service_role;

create policy sangria_line_select on public.sangria_line for select to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create policy sangria_line_update on public.sangria_line for update to authenticated
  using (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_line.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  )
  with check (tenant_id in (select public.staff_tenant_ids()));

create policy sangria_deposit_select on public.sangria_deposit for select to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create policy sangria_deposit_insert on public.sangria_deposit for insert to authenticated
  with check (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_deposit.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

create policy sangria_deposit_delete on public.sangria_deposit for delete to authenticated
  using (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_deposit.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

create policy sangria_deposit_day_select on public.sangria_deposit_day for select to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create policy sangria_deposit_day_insert on public.sangria_deposit_day for insert to authenticated
  with check (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1 from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = sangria_deposit_day.tenant_id
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

create policy sangria_deposit_day_delete on public.sangria_deposit_day for delete to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
