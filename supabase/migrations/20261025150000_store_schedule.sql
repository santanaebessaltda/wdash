-- Escala da filial. A configuração é de um mês; o dia ajustado na mão sobrevive a gerar de novo.

create table if not exists public.store_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  month_start date not null,
  pattern text not null check (pattern in ('6x1', '5x2', '12x36')),
  off_mode text not null check (off_mode in ('rotating', 'fixed')),
  sunday_min smallint not null default 1 check (sunday_min between 0 and 5),
  extra_holidays jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  unique (store_id, month_start)
);

create table if not exists public.store_schedule_person (
  tenant_id uuid not null,
  store_id uuid not null,
  schedule_id uuid not null references public.store_schedule (id) on delete cascade,
  seller_id uuid not null references public.store_seller (id) on delete cascade,
  fixed_off_dow smallint check (fixed_off_dow between 1 and 6),
  primary key (schedule_id, seller_id)
);

create table if not exists public.store_schedule_day (
  tenant_id uuid not null,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  seller_id uuid not null references public.store_seller (id) on delete cascade,
  status text not null check (status in ('work', 'off', 'holiday_work', 'comp_off')),
  origin text not null check (origin in ('generated', 'manual')),
  primary key (store_id, day, seller_id)
);

create index if not exists store_schedule_day_month_idx
  on public.store_schedule_day (store_id, day);

alter table public.store_schedule enable row level security;
alter table public.store_schedule_person enable row level security;
alter table public.store_schedule_day enable row level security;

grant select, insert, update, delete on public.store_schedule to authenticated;
grant select, insert, update, delete on public.store_schedule_person to authenticated;
grant select, insert, update, delete on public.store_schedule_day to authenticated;
grant select, insert, update, delete on public.store_schedule to service_role;
grant select, insert, update, delete on public.store_schedule_person to service_role;
grant select, insert, update, delete on public.store_schedule_day to service_role;

create policy store_schedule_select on public.store_schedule for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));
create policy store_schedule_write on public.store_schedule for all to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

create policy store_schedule_person_select on public.store_schedule_person for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));
create policy store_schedule_person_write on public.store_schedule_person for all to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

create policy store_schedule_day_select on public.store_schedule_day for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));
create policy store_schedule_day_write on public.store_schedule_day for all to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));
