-- Várias contas Millennium por empresa. Cada filial fica em uma credencial.
-- A fila (sync_job.credential_id) já era por conta; a loja passa a ser também.

alter table public.erp_credential
  drop constraint if exists erp_credential_tenant_id_key;

create unique index if not exists erp_credential_tenant_username_uidx
  on public.erp_credential (tenant_id, username);

alter table public.store
  add column if not exists credential_id uuid references public.erp_credential (id) on delete cascade;

-- Antes desta migration só existia uma credencial por empresa.
update public.store s
set credential_id = c.id
from public.erp_credential c
where s.credential_id is null
  and c.tenant_id = s.tenant_id;

create index if not exists store_credential_idx on public.store (credential_id);
