-- Modo Geral: a loja sobe de nível pelo total vendido e a premiação se divide igualmente.
-- Sem grupos de distribuição e sem meta individual.

alter table public.goal drop constraint if exists goal_tier_mode_check;

alter table public.goal
  add constraint goal_tier_mode_check
  check (tier_mode in ('INDIVIDUAL', 'GROUP', 'GENERAL'));

comment on column public.goal.tier_mode is
  'INDIVIDUAL = cada pessoa pela própria meta; GROUP = o grupo sobe pela soma das vendas; GENERAL = a loja sobe pelo total vendido e a premiação é dividida igualmente.';
