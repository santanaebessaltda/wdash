-- Sazonalidade do aluguel mínimo. Mês que se repete (month 1–12) ou um mês específico (year_month).

alter table public.store
  add column if not exists rent_seasons jsonb not null default '[]'::jsonb;

comment on column public.store.rent_seasons is
  'Fator do aluguel mínimo. month 1–12 repete todo ano; yearMonth (AAAA-MM) vale só naquele mês.';
