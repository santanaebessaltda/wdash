-- Gerente edita o fechamento do dia nas filiais que já pode escrever.
-- Sem vínculo de loja = todas. Gestor continua em qualquer filial do tenant.

drop policy if exists cash_close_review_write on public.cash_close_review;
create policy cash_close_review_write
  on public.cash_close_review for insert
  to authenticated
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists cash_close_review_update on public.cash_close_review;
create policy cash_close_review_update
  on public.cash_close_review for update
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id))
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists cash_close_review_delete on public.cash_close_review;
create policy cash_close_review_delete
  on public.cash_close_review for delete
  to authenticated
  using (public.staff_can_write_store(tenant_id, store_id));

comment on table public.cash_close_review is
  'Ajuste do gestor ou do gerente no fechamento do dia. A sincronização do Millennium não mexe nesta tabela.';
