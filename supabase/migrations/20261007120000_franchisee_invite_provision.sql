-- Invite do painel Supabase (Authentication > Users > Invite) = franqueado novo.
-- Cria tenant + identity PENDING + membership OWNER (is_owner, onboarding_step = 2).
-- Convites da WDash (Configuracoes > Usuarios / Vendedores) mandam raw_user_meta_data.wdash = 'member'
-- e nao passam por este caminho.

create or replace function public.provision_franchisee_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  company_name text;
  local_part text;
  new_tenant_id uuid;
  new_identity_id uuid;
begin
  -- So convite (e-mail de invite). Signup comum nao entra.
  if new.invited_at is null then
    return new;
  end if;

  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  -- Convite interno da WDash (gestor/gerente/vendedor da mesma empresa).
  if meta->>'wdash' = 'member' then
    return new;
  end if;

  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  if exists (select 1 from public.identity i where i.auth_user_id = new.id) then
    return new;
  end if;

  if exists (select 1 from public.identity i where lower(i.email) = lower(new.email)) then
    return new;
  end if;

  local_part := split_part(lower(btrim(new.email)), '@', 1);
  company_name := upper(regexp_replace(btrim(local_part), '[._+-]+', ' ', 'g'));
  company_name := nullif(regexp_replace(company_name, '\s+', ' ', 'g'), '');
  if company_name is null then
    company_name := 'NOVA EMPRESA';
  end if;

  -- Metadados do e-mail ({{ .Data.role }} / {{ .Data.company }}).
  new.raw_user_meta_data :=
    meta || jsonb_build_object('wdash', 'franchisee', 'role', 'Gestor', 'company', company_name);

  insert into public.tenant (name)
  values (company_name)
  returning id into new_tenant_id;

  insert into public.identity (auth_user_id, email, name, status)
  values (new.id, lower(btrim(new.email)), '', 'PENDING')
  returning id into new_identity_id;

  insert into public.membership (identity_id, tenant_id, role, status, is_owner, onboarding_step)
  values (new_identity_id, new_tenant_id, 'OWNER', 'PENDING', true, 2);

  return new;
end;
$$;

revoke all on function public.provision_franchisee_invite() from public, anon, authenticated;
grant execute on function public.provision_franchisee_invite() to supabase_auth_admin;

drop trigger if exists on_auth_user_franchisee_invite on auth.users;
create trigger on_auth_user_franchisee_invite
  before insert on auth.users
  for each row
  execute function public.provision_franchisee_invite();

comment on function public.provision_franchisee_invite() is
  'Painel Supabase Invite sem wdash=member: provisiona franqueado (tenant + OWNER + onboarding ERP).';
