-- Gerente fica na operação da filial. Gestor (OWNER / ADMIN_GLOBAL) não muda.
-- Vínculo vazio do gerente continua significando todas as filiais.

create or replace function public.account_owner_of(p_tenant uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.membership m
    join public.identity i on i.id = m.identity_id
    where i.auth_user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.tenant_id = p_tenant
      and m.role in ('OWNER', 'ADMIN_GLOBAL')
  );
$$;

create or replace function public.staff_can_read_store(p_tenant uuid, p_store uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.membership m
    join public.identity i on i.id = m.identity_id
    where i.auth_user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.tenant_id = p_tenant
      and (
        m.role in ('OWNER', 'ADMIN_GLOBAL')
        or (
          m.role = 'MANAGER'
          and (
            not exists (select 1 from public.membership_store ms where ms.membership_id = m.id)
            or exists (
              select 1 from public.membership_store ms
              where ms.membership_id = m.id and ms.store_id = p_store::text
            )
          )
        )
        or (
          m.role = 'SELLER'
          and exists (
            select 1 from public.membership_store ms
            where ms.membership_id = m.id and ms.store_id = p_store::text
          )
        )
      )
  );
$$;

revoke all on function public.account_owner_of(uuid) from public, anon;
revoke all on function public.staff_can_read_store(uuid, uuid) from public, anon;
grant execute on function public.account_owner_of(uuid) to authenticated, service_role;
grant execute on function public.staff_can_read_store(uuid, uuid) to authenticated, service_role;

-- Leitura das filiais do vínculo.
drop policy if exists store_select_own on public.store;
create policy store_select_own on public.store for select to authenticated
  using (public.staff_can_read_store(tenant_id, id));

drop policy if exists sales_day_agg_select_own on public.sales_day_agg;
create policy sales_day_agg_select_own on public.sales_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_hour_agg_select_own on public.sales_hour_agg;
create policy sales_hour_agg_select_own on public.sales_hour_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_payment_day_agg_select_own on public.sales_payment_day_agg;
create policy sales_payment_day_agg_select_own on public.sales_payment_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_category_day_agg_select_own on public.sales_category_day_agg;
create policy sales_category_day_agg_select_own on public.sales_category_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_product_day_agg_select_own on public.sales_product_day_agg;
create policy sales_product_day_agg_select_own on public.sales_product_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_product_cost_day_agg_select_own on public.sales_product_cost_day_agg;
create policy sales_product_cost_day_agg_select_own on public.sales_product_cost_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_seller_day_agg_select_own on public.sales_seller_day_agg;
create policy sales_seller_day_agg_select_own on public.sales_seller_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sales_seller_product_day_agg_select_own on public.sales_seller_product_day_agg;
create policy sales_seller_product_day_agg_select_own on public.sales_seller_product_day_agg for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists goal_select_own on public.goal;
create policy goal_select_own on public.goal for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists challenge_select_own on public.challenge;
create policy challenge_select_own on public.challenge for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists store_seller_select_own on public.store_seller;
create policy store_seller_select_own on public.store_seller for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists store_shift_select_own on public.store_shift;
create policy store_shift_select_own on public.store_shift for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists cash_close_day_select_own on public.cash_close_day;
create policy cash_close_day_select_own on public.cash_close_day for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists cash_close_sale_select_own on public.cash_close_sale;
create policy cash_close_sale_select_own on public.cash_close_sale for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists cash_close_review_select on public.cash_close_review;
create policy cash_close_review_select on public.cash_close_review for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sangria_line_select on public.sangria_line;
create policy sangria_line_select on public.sangria_line for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sangria_deposit_select on public.sangria_deposit;
create policy sangria_deposit_select on public.sangria_deposit for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sangria_deposit_day_select on public.sangria_deposit_day;
create policy sangria_deposit_day_select on public.sangria_deposit_day for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists sangria_shortage_select on public.sangria_shortage;
create policy sangria_shortage_select on public.sangria_shortage for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

drop policy if exists shopping_day_select on public.shopping_day;
create policy shopping_day_select on public.shopping_day for select to authenticated
  using (public.staff_can_read_store(tenant_id, store_id));

-- Custos estratégicos e pedido de compra: só o gestor lê e grava.
drop policy if exists store_cost_item_select_own on public.store_cost_item;
create policy store_cost_item_select_own on public.store_cost_item for select to authenticated
  using (public.account_owner_of(tenant_id));

drop policy if exists store_shopping_select on public.store_shopping;
create policy store_shopping_select on public.store_shopping for select to authenticated
  using (public.account_owner_of(tenant_id));

drop policy if exists store_purchase_stock_select_own on public.store_purchase_stock;
create policy store_purchase_stock_select_own on public.store_purchase_stock for select to authenticated
  using (public.account_owner_of(tenant_id));

drop policy if exists store_purchase_min_select_own on public.store_purchase_min;
create policy store_purchase_min_select_own on public.store_purchase_min for select to authenticated
  using (public.account_owner_of(tenant_id));

drop policy if exists store_purchase_min_write on public.store_purchase_min;
create policy store_purchase_min_write on public.store_purchase_min for all to authenticated
  using (public.account_owner_of(tenant_id))
  with check (
    public.account_owner_of(tenant_id)
    and exists (
      select 1 from public.store s
      where s.id = store_purchase_min.store_id and s.tenant_id = store_purchase_min.tenant_id
    )
  );

-- Meta, desafio, grupo, horário e cadastro da equipe: o gerente consulta, o gestor grava.
drop policy if exists goal_write_managers on public.goal;
create policy goal_write_managers on public.goal for all to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

drop policy if exists challenge_write_managers on public.challenge;
create policy challenge_write_managers on public.challenge for all to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

drop policy if exists store_shift_write_managers on public.store_shift;
create policy store_shift_write_managers on public.store_shift for all to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

drop policy if exists store_update_own on public.store;
create policy store_update_own on public.store for update to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

drop policy if exists store_seller_update_shift on public.store_seller;
drop policy if exists store_seller_update_central on public.store_seller;
create policy store_seller_update_owner on public.store_seller for update to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

-- Fechamento: o gerente grava o primeiro ajuste. Não altera nem apaga um dia já salvo.
drop policy if exists cash_close_review_update on public.cash_close_review;
create policy cash_close_review_update on public.cash_close_review for update to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

drop policy if exists cash_close_review_delete on public.cash_close_review;
create policy cash_close_review_delete on public.cash_close_review for delete to authenticated
  using (public.account_owner_of(tenant_id));

-- Sangria recebida não volta e não muda para o gerente.
drop policy if exists sangria_line_update on public.sangria_line;
create policy sangria_line_update on public.sangria_line for update to authenticated
  using (
    public.staff_can_write_store(tenant_id, store_id)
    and (
      public.account_owner_of(tenant_id)
      or not exists (
        select 1 from public.sangria_deposit_day d
        where d.store_id = sangria_line.store_id and d.day = sangria_line.day
      )
    )
  )
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists sangria_shortage_update on public.sangria_shortage;
create policy sangria_shortage_update on public.sangria_shortage for update to authenticated
  using (
    public.staff_can_write_store(tenant_id, store_id)
    and (
      public.account_owner_of(tenant_id)
      or not exists (
        select 1 from public.sangria_deposit_day d
        where d.store_id = sangria_shortage.store_id and d.day = sangria_shortage.day
      )
    )
  )
  with check (public.staff_can_write_store(tenant_id, store_id));

drop policy if exists sangria_shortage_delete on public.sangria_shortage;
create policy sangria_shortage_delete on public.sangria_shortage for delete to authenticated
  using (
    public.staff_can_write_store(tenant_id, store_id)
    and (
      public.account_owner_of(tenant_id)
      or not exists (
        select 1 from public.sangria_deposit_day d
        where d.store_id = sangria_shortage.store_id and d.day = sangria_shortage.day
      )
    )
  );

drop policy if exists sangria_deposit_delete on public.sangria_deposit;
create policy sangria_deposit_delete on public.sangria_deposit for delete to authenticated
  using (public.account_owner_of(tenant_id));

drop policy if exists sangria_deposit_day_delete on public.sangria_deposit_day;
create policy sangria_deposit_day_delete on public.sangria_deposit_day for delete to authenticated
  using (public.account_owner_of(tenant_id));

-- Vídeos: o gestor vê a biblioteca inteira. O gerente assiste só o que está visível para o perfil.
drop policy if exists help_video_select on public.help_video;
create policy help_video_select
  on public.help_video for select
  to authenticated
  using (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.tenant_id = help_video.tenant_id
        and m.status = 'ACTIVE'
        and (
          m.role in ('OWNER', 'ADMIN_GLOBAL')
          or (help_video.visible and m.role = any (help_video.audiences))
        )
    )
  );

drop policy if exists help_videos_select on storage.objects;
create policy help_videos_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'help-videos'
    and exists (
      select 1
      from public.help_video v
      join public.membership m on m.tenant_id = v.tenant_id
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and v.tenant_id::text = (storage.foldername(objects.name))[1]
        and v.id::text = (storage.foldername(objects.name))[2]
        and (
          m.role in ('OWNER', 'ADMIN_GLOBAL')
          or (v.visible and m.role = any (v.audiences))
        )
    )
  );

-- Vídeos: o gerente assiste. Só o gestor envia, edita e apaga.
drop policy if exists help_video_write on public.help_video;
create policy help_video_write on public.help_video for all to authenticated
  using (public.account_owner_of(tenant_id))
  with check (public.account_owner_of(tenant_id));

drop policy if exists help_videos_insert on storage.objects;
create policy help_videos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'help-videos'
    and (storage.foldername(name))[1] in (
      select m.tenant_id::text
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists help_videos_delete on storage.objects;
create policy help_videos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'help-videos'
    and (storage.foldername(name))[1] in (
      select m.tenant_id::text
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );
