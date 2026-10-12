-- Convite cancelado deixa de ocupar o e-mail. A conta PENDING sem nenhum acesso
-- e apagada de verdade (usuario do Auth, identidades e tokens), para o proximo
-- convite nascer com um link novo. Conta ja aceita ou com acesso nao e tocada.

create or replace function public.release_orphan_invite(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_user_id uuid;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then
    return false;
  end if;

  if exists (
    select 1
    from public.identity i
    where lower(i.email) = v_email
      and (
        i.status <> 'PENDING'
        or exists (select 1 from public.membership m where m.identity_id = i.id)
      )
  ) then
    return false;
  end if;

  for v_user_id in
    select u.id
    from auth.users u
    where lower(u.email) = v_email
      and u.email_confirmed_at is null
  loop
    begin
      delete from auth.identities where user_id = v_user_id;
    exception when undefined_table then
      null;
    end;
    begin
      delete from auth.refresh_tokens where user_id = v_user_id;
    exception when undefined_table or undefined_column then
      null;
    end;
    begin
      delete from auth.sessions where user_id = v_user_id;
    exception when undefined_table or undefined_column then
      null;
    end;
    begin
      delete from auth.mfa_factors where user_id = v_user_id;
    exception when undefined_table or undefined_column then
      null;
    end;
    if to_regclass('auth.one_time_tokens') is not null then
      begin
        execute 'delete from auth.one_time_tokens where user_id = $1' using v_user_id;
      exception when undefined_column then
        null;
      end;
    end if;
    delete from auth.users where id = v_user_id;
  end loop;

  delete from public.identity i
  where lower(i.email) = v_email
    and i.status = 'PENDING'
    and not exists (select 1 from public.membership m where m.identity_id = i.id);

  return true;
end;
$$;

revoke all on function public.release_orphan_invite(text) from public, anon, authenticated;
grant execute on function public.release_orphan_invite(text) to service_role;

comment on function public.release_orphan_invite(text) is
  'Apaga convite cancelado (PENDING sem acesso) para o mesmo e-mail poder receber um link novo.';
