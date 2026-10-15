-- PIX online do extrato, somado ao valor da adquirente.
-- A sincronização do Millennium não mexe em cash_close_review.

alter table public.cash_close_review
  add column if not exists online_pix jsonb not null default '[]'::jsonb;

comment on column public.cash_close_review.online_pix is
  'PIX online do extrato, fora da adquirente: [{id, cents, note}]. Soma com o valor da adquirente no total real do Pix. Não substitui o arquivo.';
