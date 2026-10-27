-- Snapshot do motor (continuation) para o mês seguinte herdar domingos e dia-base.
alter table public.store_schedule
  add column if not exists generator_snapshot jsonb;
