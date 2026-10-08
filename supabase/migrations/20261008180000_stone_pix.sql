-- PIX da Stone (CSV) e o controle do pedido assíncrono. Não altera o faturamento.
-- card = extrato XML já baixado. pix = pedido feito (requested) ou CSV gravado (received).

create table if not exists public.stone_pix (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  event_id text not null,
  e2e_id text not null default '',
  status text not null default '',
  paid_cents bigint not null,
  canceled_cents bigint not null default 0,
  fee_cents bigint not null default 0,
  occurred_at timestamptz,
  terminal_serial text not null default '',
  primary key (tenant_id, store_id, event_id)
);

create index if not exists stone_pix_day_idx
  on public.stone_pix (tenant_id, store_id, day);

comment on table public.stone_pix is
  'Venda PIX da Stone no dia de referência do CSV. O faturamento continua em sales_day_agg.';

alter table public.stone_pix enable row level security;

grant select on public.stone_pix to authenticated;
grant select, insert, update, delete on public.stone_pix to service_role;

drop policy if exists stone_pix_select_own on public.stone_pix;
create policy stone_pix_select_own
  on public.stone_pix for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

create table if not exists public.stone_day_file (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('card', 'pix')),
  status text not null check (status in ('requested', 'received')),
  requested_at timestamptz,
  received_at timestamptz,
  primary key (tenant_id, store_id, day, kind)
);

comment on table public.stone_day_file is
  'Controle do arquivo Stone do dia. card received = XML gravado. pix requested = pedido feito; received = CSV gravado, mesmo vazio.';

alter table public.stone_day_file enable row level security;

grant select on public.stone_day_file to authenticated;
grant select, insert, update, delete on public.stone_day_file to service_role;

drop policy if exists stone_day_file_select_own on public.stone_day_file;
create policy stone_day_file_select_own
  on public.stone_day_file for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
