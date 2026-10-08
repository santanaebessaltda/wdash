-- GoTrue costuma gravar invited_at no INSERT; em alguns caminhos (generateLink) o BEFORE
-- via o usuario sem invited_at. Provisiona no AFTER INSERT/UPDATE quando o convite existe
-- e ainda nao ha identity.

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
  email_text text;
begin
  if new.invited_at is null then
    return new;
  end if;

  -- UPDATE que nao muda o convite: nao reprovisiona.
  if tg_op = 'UPDATE' and old.invited_at is not null then
    return new;
  end if;

  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  if meta->>'wdash' = 'member' then
    return new;
  end if;

  email_text := lower(btrim(coalesce(new.email, '')));
  if email_text = '' then
    return new;
  end if;

  if exists (select 1 from public.identity i where i.auth_user_id = new.id) then
    return new;
  end if;

  if exists (select 1 from public.identity i where lower(i.email) = email_text) then
    return new;
  end if;

  local_part := split_part(email_text, '@', 1);
  company_name := upper(regexp_replace(btrim(local_part), '[._+-]+', ' ', 'g'));
  company_name := nullif(regexp_replace(company_name, '\s+', ' ', 'g'), '');
  if company_name is null then
    company_name := 'NOVA EMPRESA';
  end if;

  meta := meta || jsonb_build_object('wdash', 'franchisee', 'role', 'Gestor', 'company', company_name);

  insert into public.tenant (name)
  values (company_name)
  returning id into new_tenant_id;

  insert into public.identity (auth_user_id, email, name, status)
  values (new.id, email_text, '', 'PENDING')
  returning id into new_identity_id;

  insert into public.membership (identity_id, tenant_id, role, status, is_owner, onboarding_step)
  values (new_identity_id, new_tenant_id, 'OWNER', 'PENDING', true, 2);

  update auth.users
  set raw_user_meta_data = meta
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_franchisee_invite on auth.users;
create trigger on_auth_user_franchisee_invite
  after insert or update of invited_at on auth.users
  for each row
  execute function public.provision_franchisee_invite();
