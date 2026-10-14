-- Documentos para assinatura. O CPF fica na ficha e o sync do Millennium não o reescreve.
alter table public.store_seller
  add column if not exists cpf text;

comment on column public.store_seller.cpf is
  'CPF só dígitos, preenchido no WDash. O sync de vendedores não grava esta coluna.';

create index if not exists store_seller_cpf_idx
  on public.store_seller (tenant_id, cpf)
  where cpf is not null;

create table if not exists public.assina_credential (
  tenant_id uuid primary key references public.tenant (id) on delete cascade,
  token_cipher text not null,
  updated_at timestamptz not null default now()
);

comment on table public.assina_credential is
  'Token do Assina AI da empresa, cifrado. O navegador não lê esta tabela.';

alter table public.assina_credential enable row level security;
grant all on public.assina_credential to service_role;

create table if not exists public.document_batch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid references public.store (id) on delete cascade,
  month int not null check (month between 1 and 12),
  year int not null check (year between 2000 and 2100),
  category text not null,
  unify boolean not null default true,
  channel text check (channel in ('EMAIL', 'WHATSAPP')),
  deadline date,
  reminder text not null default 'EVERY_3_DAYS'
    check (reminder in ('EVERY_DAY', 'EVERY_3_DAYS', 'EVERY_WEEK', 'NEVER')),
  created_at timestamptz not null default now()
);

create index if not exists document_batch_tenant_idx
  on public.document_batch (tenant_id, created_at desc);

create table if not exists public.employee_document (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.document_batch (id) on delete cascade,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid references public.store (id) on delete cascade,
  seller_id uuid references public.store_seller (id) on delete set null,
  status text not null default 'UNASSIGNED'
    check (status in ('UNASSIGNED', 'PENDING', 'SIGNED', 'DECLINED', 'EXPIRED')),
  envelope_id text,
  recipient_id text,
  storage_path text not null,
  signed_storage_path text,
  file_name text not null,
  page_count int not null default 1,
  size_bytes int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists employee_document_batch_idx
  on public.employee_document (batch_id);
create index if not exists employee_document_seller_idx
  on public.employee_document (tenant_id, seller_id);

create table if not exists public.document_event (
  event_id text primary key,
  envelope_id text not null,
  received_at timestamptz not null default now()
);

alter table public.document_batch enable row level security;
alter table public.employee_document enable row level security;
alter table public.document_event enable row level security;

grant select on public.document_batch, public.employee_document to authenticated;
grant all on public.document_batch, public.employee_document, public.document_event to service_role;

create policy document_batch_select_owner
  on public.document_batch for select
  to authenticated
  using (
    tenant_id in (
      select m.tenant_id
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

create policy employee_document_select_owner
  on public.employee_document for select
  to authenticated
  using (
    tenant_id in (
      select m.tenant_id
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
