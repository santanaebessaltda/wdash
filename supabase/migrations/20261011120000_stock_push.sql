-- Aviso de estoque abaixo do mínimo do Pedido de compra. Padrão ligado, como os outros pushes.

alter table public.notification_pref
  add column if not exists stock boolean not null default true;

comment on column public.notification_pref.stock is
  'Push diário dos produtos abaixo do mínimo do Pedido de compra.';

alter table public.notification_mark drop constraint if exists notification_mark_kind_check;

alter table public.notification_mark
  add constraint notification_mark_kind_check
  check (kind in ('store_goal', 'cash_close', 'stock_low'));

comment on table public.notification_mark is
  'Último aviso enviado. store_goal = id da meta; cash_close = dia; stock_low = loja|dia.';
