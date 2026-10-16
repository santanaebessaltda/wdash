-- Estabelecimento Cielo por filial. Certificado, client_id e chave HMAC ficam no worker.
-- cielo_capture / cielo_pix guardam a captura do dia. Não alteram o faturamento.

create table if not exists public.store_cielo (
  store_id uuid primary key references public.store (id) on delete cascade,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  establishment_code text not null,
  constraint store_cielo_code_trim check (length(btrim(establishment_code)) = 10),
  constraint store_cielo_code_unique unique (tenant_id, establishment_code)
);

comment on table public.store_cielo is
  'Número do estabelecimento Cielo da filial. O certificado e a chave ficam no worker.';

alter table public.store_cielo enable row level security;

grant select, insert, update, delete on public.store_cielo to service_role;
grant select (store_id, tenant_id, establishment_code) on public.store_cielo to authenticated;

drop policy if exists store_cielo_select_own on public.store_cielo;
create policy store_cielo_select_own
  on public.store_cielo for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create table if not exists public.cielo_capture (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  acquirer_key text not null,
  payment_method text not null,
  captured_cents bigint not null,
  occurred_at timestamptz,
  primary key (tenant_id, store_id, acquirer_key)
);

create index if not exists cielo_capture_day_idx
  on public.cielo_capture (tenant_id, store_id, day);

comment on table public.cielo_capture is
  'Captura Cielo do dia (CIELO03), crédito e débito. Liquidação de venda anterior não entra.';

alter table public.cielo_capture enable row level security;

grant select on public.cielo_capture to authenticated;
grant select, insert, update, delete on public.cielo_capture to service_role;

drop policy if exists cielo_capture_select_own on public.cielo_capture;
create policy cielo_capture_select_own
  on public.cielo_capture for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create table if not exists public.cielo_pix (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  pix_id text not null,
  paid_cents bigint not null,
  occurred_at timestamptz,
  primary key (tenant_id, store_id, pix_id)
);

create index if not exists cielo_pix_day_idx
  on public.cielo_pix (tenant_id, store_id, day);

comment on table public.cielo_pix is
  'Pix Cielo do dia (CIELO16). O faturamento continua em sales_day_agg.';

alter table public.cielo_pix enable row level security;

grant select on public.cielo_pix to authenticated;
grant select, insert, update, delete on public.cielo_pix to service_role;

drop policy if exists cielo_pix_select_own on public.cielo_pix;
create policy cielo_pix_select_own
  on public.cielo_pix for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create table if not exists public.cielo_day_file (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('card', 'pix')),
  status text not null check (status in ('received')),
  received_at timestamptz,
  primary key (tenant_id, store_id, day, kind)
);

comment on table public.cielo_day_file is
  'Arquivo Cielo do dia já gravado. received com soma zero continua sendo arquivo chegado.';

alter table public.cielo_day_file enable row level security;

grant select on public.cielo_day_file to authenticated;
grant select, insert, update, delete on public.cielo_day_file to service_role;

drop policy if exists cielo_day_file_select_own on public.cielo_day_file;
create policy cielo_day_file_select_own
  on public.cielo_day_file for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
