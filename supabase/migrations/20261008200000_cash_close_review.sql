-- Ajuste do gestor no fechamento: dinheiro digitado, justificativa e falta assumida pela loja.
-- Fica fora de cash_close_day porque a sincronização apaga e regrava aquele fechamento.

create table if not exists public.cash_close_review (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  store_id uuid not null references public.store (id) on delete cascade,
  day date not null,
  cash_typed_cents bigint,
  justification text not null default '',
  waive boolean not null default false,
  primary key (tenant_id, store_id, day)
);

comment on table public.cash_close_review is
  'Ajuste do gestor sobre o dinheiro do fechamento. Não descontar (waive) = a loja assume a falta. A sincronização do Millennium não mexe nesta tabela.';

alter table public.cash_close_review enable row level security;

grant select on public.cash_close_review to authenticated;
grant select, insert, update, delete on public.cash_close_review to service_role;
grant insert, update, delete on public.cash_close_review to authenticated;

drop policy if exists cash_close_review_select on public.cash_close_review;
create policy cash_close_review_select
  on public.cash_close_review for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

drop policy if exists cash_close_review_write on public.cash_close_review;
create policy cash_close_review_write
  on public.cash_close_review for insert
  to authenticated
  with check (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = cash_close_review.tenant_id
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists cash_close_review_update on public.cash_close_review;
create policy cash_close_review_update
  on public.cash_close_review for update
  to authenticated
  using (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = cash_close_review.tenant_id
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  )
  with check (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = cash_close_review.tenant_id
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists cash_close_review_delete on public.cash_close_review;
create policy cash_close_review_delete
  on public.cash_close_review for delete
  to authenticated
  using (
    tenant_id in (select public.staff_tenant_ids())
    and exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.tenant_id = cash_close_review.tenant_id
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );
