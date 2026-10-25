-- O 4×3 entra nos tipos, e o período gravado pode começar no meio do mês.

alter table public.store_schedule drop constraint if exists store_schedule_pattern_check;

alter table public.store_schedule
  add constraint store_schedule_pattern_check check (pattern in ('6x1', '5x2', '4x3', '12x36'));

alter table public.store_schedule
  add column if not exists period_start date,
  add column if not exists period_end date;
