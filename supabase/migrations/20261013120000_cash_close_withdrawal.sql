-- Retirada de funcionários no dia do fechamento.
-- A sincronização do Millennium não mexe em cash_close_review.

alter table public.cash_close_review
  add column if not exists withdrawals jsonb not null default '[]'::jsonb;

comment on column public.cash_close_review.withdrawals is
  'Retirada de funcionários: [{sellerId, cents}]. A soma não passa da quebra em dinheiro. O restante continua quebra de caixa. O desconto entra no holerite do mês seguinte.';
