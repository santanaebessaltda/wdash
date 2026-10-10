-- Inscrição Web Push do PWA. O worker envia o resumo da rodada automática.

create table if not exists public.push_subscription (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscription_tenant_idx
  on public.push_subscription (tenant_id, auth_user_id);

alter table public.push_subscription enable row level security;

grant select, insert, update, delete on public.push_subscription to authenticated;
grant select, insert, update, delete on public.push_subscription to service_role;

create policy push_subscription_select_own
  on public.push_subscription for select
  to authenticated
  using (auth_user_id = auth.uid());

create policy push_subscription_insert_own
  on public.push_subscription for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.tenant_id = push_subscription.tenant_id
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

create policy push_subscription_update_own
  on public.push_subscription for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy push_subscription_delete_own
  on public.push_subscription for delete
  to authenticated
  using (auth_user_id = auth.uid());
