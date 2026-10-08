-- A tela lê Stone Code e cobertura. A chave cifrada continua só no service_role.

drop policy if exists store_stone_select_own on public.store_stone;
create policy store_stone_select_own
  on public.store_stone for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));

grant select (store_id, tenant_id, stone_code, covers) on public.store_stone to authenticated;
