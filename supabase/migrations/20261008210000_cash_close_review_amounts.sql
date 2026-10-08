-- Valores digitados e da adquirente por forma, no ajuste do gestor.
-- Fora de cash_close_day: a sincronização apaga e regrava aquele fechamento.

alter table public.cash_close_review
  add column if not exists typed_cents jsonb not null default '{}'::jsonb,
  add column if not exists acquirer_cents jsonb not null default '{}'::jsonb;

comment on column public.cash_close_review.typed_cents is
  'Valor digitado por forma, em centavos, quando o gestor altera o que veio do Millennium. Entra uma vez na linha já somada.';

comment on column public.cash_close_review.acquirer_cents is
  'Valor da adquirente digitado à mão, em centavos, quando a Stone não trouxe o arquivo daquela forma.';
