-- Memória de longo prazo do JARVIS por Gestor (sobrevive a Apagar conversa).
-- facts = [{ "id", "text", "at" }] — preferências e fatos que o modelo grava via tool.

create table if not exists public.jarvis_memory (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  membership_id uuid not null references public.membership (id) on delete cascade,
  facts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, membership_id),
  constraint jarvis_memory_facts_is_array check (jsonb_typeof(facts) = 'array')
);

comment on table public.jarvis_memory is
  'Memória de longo prazo do Chat IA (JARVIS) por membership do Gestor. Não é o thread do chat.';

create index if not exists jarvis_memory_membership_idx on public.jarvis_memory (membership_id);

alter table public.jarvis_memory enable row level security;

drop policy if exists jarvis_memory_select_own on public.jarvis_memory;
create policy jarvis_memory_select_own
  on public.jarvis_memory for select
  to authenticated
  using (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where m.id = jarvis_memory.membership_id
        and m.tenant_id = jarvis_memory.tenant_id
        and i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists jarvis_memory_insert_own on public.jarvis_memory;
create policy jarvis_memory_insert_own
  on public.jarvis_memory for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where m.id = jarvis_memory.membership_id
        and m.tenant_id = jarvis_memory.tenant_id
        and i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists jarvis_memory_update_own on public.jarvis_memory;
create policy jarvis_memory_update_own
  on public.jarvis_memory for update
  to authenticated
  using (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where m.id = jarvis_memory.membership_id
        and m.tenant_id = jarvis_memory.tenant_id
        and i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  )
  with check (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where m.id = jarvis_memory.membership_id
        and m.tenant_id = jarvis_memory.tenant_id
        and i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists jarvis_memory_delete_own on public.jarvis_memory;
create policy jarvis_memory_delete_own
  on public.jarvis_memory for delete
  to authenticated
  using (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where m.id = jarvis_memory.membership_id
        and m.tenant_id = jarvis_memory.tenant_id
        and i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

grant select, insert, update, delete on public.jarvis_memory to authenticated;
