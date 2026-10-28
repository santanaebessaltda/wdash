-- Tokens OAuth da conciliadora Cielo (callback /hooks/cielo/oauth).
-- Access e refresh ficam cifrados com a mesma chave do ERP (ERP_SECRET_KEY).

create table if not exists public.cielo_oauth_grant (
  id uuid primary key default gen_random_uuid(),
  state text,
  access_ciphertext text,
  refresh_ciphertext text,
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cielo_oauth_grant is
  'Concessão OAuth Cielo (conciliadora). Tokens cifrados; só o worker grava.';
comment on column public.cielo_oauth_grant.state is
  'state do redirect OAuth (pode carregar tenant_id no futuro).';
comment on column public.cielo_oauth_grant.access_ciphertext is
  'AES-GCM do access_token. Só service_role.';
comment on column public.cielo_oauth_grant.refresh_ciphertext is
  'AES-GCM do refresh_token. Só service_role.';

create index if not exists cielo_oauth_grant_state_idx
  on public.cielo_oauth_grant (state)
  where state is not null and length(btrim(state)) > 0;

create index if not exists cielo_oauth_grant_created_idx
  on public.cielo_oauth_grant (created_at desc);

alter table public.cielo_oauth_grant enable row level security;

grant select, insert, update, delete on public.cielo_oauth_grant to service_role;
