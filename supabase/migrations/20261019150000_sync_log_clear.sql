-- Conta > Logs. O gestor apaga os erros e avisos da própria conta.
grant delete on public.sync_log to authenticated;

create policy sync_log_delete_owner
  on public.sync_log for delete
  to authenticated
  using (
    tenant_id in (
      select m.tenant_id
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN_GLOBAL')
    )
  );
