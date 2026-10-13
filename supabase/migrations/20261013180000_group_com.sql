-- Group COM usa a mesma linha de acesso do shopping. A unidade escolhida fica sem a senha.

alter table public.store_shopping drop constraint if exists store_shopping_administrator_check;

alter table public.store_shopping add constraint store_shopping_administrator_check
  check (administrator in ('allos', 'argo', 'groupcom'));

alter table public.store_shopping add column if not exists unit jsonb;

comment on column public.store_shopping.unit is
  'Unidade escolhida no Group COM: contrato, empresa e código da loja. Sem senha.';

grant select (unit) on public.store_shopping to authenticated;
