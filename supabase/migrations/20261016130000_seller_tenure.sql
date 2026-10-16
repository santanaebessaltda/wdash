-- Admissão (Millennium) e saída (dia em que a WDash viu o desligamento) para meta e desafio proporcionais.
alter table public.store_seller
  add column if not exists admitted_on date,
  add column if not exists departed_on date;

comment on column public.store_seller.admitted_on is
  'DATA_ADMISSAO do Millennium, no dia local. Null = participa do período inteiro desde o início.';

comment on column public.store_seller.departed_on is
  'Dia em que a sincronização viu a pessoa sair da equipe. Null = sem saída gravada.';
