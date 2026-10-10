-- Fechamento e sangria anteriores a outubro/2026 vieram da carga de histórico.
-- Vendas desses meses ficam. O worker não busca de novo antes do mês em que a conta entrou.

delete from public.cash_close_sale where day < date '2026-10-01';
delete from public.cash_close_day where day < date '2026-10-01';
delete from public.cash_close_review where day < date '2026-10-01';
delete from public.stone_capture where day < date '2026-10-01';
delete from public.stone_pix where day < date '2026-10-01';
delete from public.stone_day_file where day < date '2026-10-01';
delete from public.sangria_line where day < date '2026-10-01';
delete from public.sangria_deposit_day where day < date '2026-10-01';
delete from public.sangria_deposit d
where not exists (
  select 1 from public.sangria_deposit_day x where x.deposit_id = d.id
);
