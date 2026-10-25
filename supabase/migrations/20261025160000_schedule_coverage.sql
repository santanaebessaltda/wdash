-- Cobertura da escala: sexo só nesta escala, pessoas por dia e por grupo, regra do feriado e folga no mês seguinte.

alter table public.store_schedule
  add column if not exists women_sunday text not null default 'every_2'
    check (women_sunday in ('every_3', 'every_2', 'all', 'none')),
  add column if not exists men_sunday text not null default 'every_3'
    check (men_sunday in ('every_3', 'every_2', 'all', 'none')),
  add column if not exists day_needs jsonb not null default '[]'::jsonb,
  add column if not exists group_needs jsonb not null default '[]'::jsonb,
  add column if not exists holiday_rules jsonb not null default '[]'::jsonb,
  add column if not exists comp_due jsonb not null default '[]'::jsonb;

alter table public.store_schedule_person
  add column if not exists sex text not null default 'woman'
    check (sex in ('woman', 'man'));
