-- Security harden (audit 2026-10-07):
-- 1) authenticated nao le senha cifrada / sessao Millennium em erp_credential
-- 2) membership_store so service_role escreve (remap na Edge)
-- 3) temporary_password: cliente so limpa via RPC (nao seta true)

-- ---------------------------------------------------------------------------
-- erp_credential: colunas secretas fora do SELECT do JWT
-- ---------------------------------------------------------------------------
revoke select on public.erp_credential from authenticated;

grant select (
  id,
  tenant_id,
  username,
  dedicated,
  status,
  last_success_at,
  last_error_at,
  last_error,
  light_interval_min,
  last_light_sync_at,
  created_at,
  updated_at,
  sync_paused,
  wedash_present_at,
  auto_refresh_enabled,
  auto_refresh_interval_min
) on public.erp_credential to authenticated;

comment on column public.erp_credential.password_ciphertext is
  'AES-GCM da senha ERP. So service_role (worker / Edges). Nunca no SELECT do authenticated.';
comment on column public.erp_credential.millennium_session is
  'Token Millennium vivo. So service_role. Nunca no SELECT do authenticated.';

-- ---------------------------------------------------------------------------
-- membership_store: sem insert/delete pelo JWT (evita widen de escopo)
-- ---------------------------------------------------------------------------
drop policy if exists membership_store_insert_own on public.membership_store;
drop policy if exists membership_store_delete_own on public.membership_store;

-- ---------------------------------------------------------------------------
-- temporary_password: revoke column update; clear via RPC
-- ---------------------------------------------------------------------------
revoke update (temporary_password) on public.identity from authenticated;

create or replace function public.clear_own_temporary_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.identity
  set temporary_password = false
  where auth_user_id = auth.uid();
end;
$$;

revoke all on function public.clear_own_temporary_password() from public;
grant execute on function public.clear_own_temporary_password() to authenticated;

comment on function public.clear_own_temporary_password() is
  'Limpa temporary_password da propria identity apos troca de senha no Auth. Nao permite setar true.';
