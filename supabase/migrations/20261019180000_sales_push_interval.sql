-- Intervalo do push de vendas: 30 min (padrão) ou 1 hora, por pessoa.
-- A base guarda o faturamento de hoje na última vez que o aviso saiu.

alter table public.notification_pref
  add column if not exists sales_every_min smallint not null default 30;

alter table public.notification_pref
  drop constraint if exists notification_pref_sales_every_min_check;

alter table public.notification_pref
  add constraint notification_pref_sales_every_min_check
  check (sales_every_min in (30, 60));

comment on column public.notification_pref.sales_every_min is
  'Intervalo do push de vendas, em minutos: 30 (padrão) ou 60. A rodada automática continua a cada 30 min.';

create table if not exists public.sales_push_state (
  auth_user_id uuid not null,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  notified_at timestamptz not null,
  baseline jsonb not null default '{}'::jsonb,
  primary key (auth_user_id, tenant_id)
);

comment on table public.sales_push_state is
  'Faturamento de hoje na última vez que o push de vendas saiu, por pessoa. O aviso de 1 hora soma a partir daqui.';

alter table public.sales_push_state enable row level security;

grant select, insert, update, delete on public.sales_push_state to service_role;
