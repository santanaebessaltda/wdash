-- Destino da falta escolhido no detalhe do fechamento.
-- A sincronização do Millennium não mexe nesta tabela.

alter table public.cash_close_review
  add column if not exists shortage_scope text not null default '',
  add column if not exists shortage_sellers jsonb not null default '[]'::jsonb,
  add column if not exists shortage_group text not null default '';

alter table public.cash_close_review
  drop constraint if exists cash_close_review_scope_chk;

alter table public.cash_close_review
  add constraint cash_close_review_scope_chk
  check (shortage_scope in ('', 'seller', 'group', 'everyone'));

comment on column public.cash_close_review.shortage_scope is
  'Quem paga a falta: seller (uma ou mais vendedoras), group, everyone. Vazio com waive = a loja assume.';
comment on column public.cash_close_review.shortage_sellers is
  'Nomes das vendedoras marcadas quando shortage_scope = seller.';
comment on column public.cash_close_review.shortage_group is
  'Nome do grupo quando shortage_scope = group.';
