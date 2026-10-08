-- Stone Code e chave cifrada ficam fora do SELECT do JWT.
-- stone_capture guarda a captura do dia (cartão) para o fechamento. Não altera o faturamento.
create table if not exists public.store_stone (
  store_id uuid primary key references public.store (id) on delete cascade,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  stone_code text not null,
  secret_ciphertext text not null,
  covers text not null default 'online_pix' check (covers in ('online_pix', 'all')),
  constraint store_stone_code_trim check (length(btrim(stone_code)) > 0)
);

comment on table public.store_stone is
  'Stone Code e chave de conciliação (AES-GCM). Só service_role. covers=all compara o arquivo com crédito, débito e PIX; online_pix só com o PIX online.';
comment on column public.store_stone.secret_ciphertext is
  'AES-GCM da chave Stone. Só service_role (worker). Nunca no SELECT do authenticated.';

alter table public.store_stone enable row level security;

grant select, insert, update, delete on public.store_stone to service_role;

create table if not exists public.stone_capture (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  acquirer_key text not null,
  occurred_at timestamptz not null,
  account_type int not null,
  payment_method text not null,
  brand_id int,
  captured_cents bigint not null,
  authorization_code text not null default '',
  installments int not null default 1,
  primary key (tenant_id, store_id, acquirer_key)
);

create index if not exists stone_capture_day_idx
  on public.stone_capture (tenant_id, store_id, day);

comment on table public.stone_capture is
  'Captura Stone do dia (valor e hora) para cruzar com a venda. Liquidação de venda anterior não entra. O faturamento continua em sales_day_agg.';

alter table public.stone_capture enable row level security;

grant select on public.stone_capture to authenticated;
grant select, insert, update, delete on public.stone_capture to service_role;

drop policy if exists stone_capture_select_own on public.stone_capture;
create policy stone_capture_select_own
  on public.stone_capture for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
