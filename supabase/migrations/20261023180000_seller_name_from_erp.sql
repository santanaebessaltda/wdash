-- O nome do vendedor é o do Millennium (store_seller). A pessoa não grava outro na WDash.
-- Gestor e gerente continuam com o nome que informam no Crie seu acesso.

create or replace function public.copy_seller_name_to_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  full_name text;
  ident uuid;
begin
  if new.membership_id is null then
    return new;
  end if;
  full_name := nullif(btrim(new.name), '');
  if full_name is null then
    return new;
  end if;
  select m.identity_id into ident
  from public.membership m
  where m.id = new.membership_id
    and m.role = 'SELLER';
  if ident is null then
    return new;
  end if;
  update public.identity
  set
    name = full_name,
    first_name = split_part(full_name, ' ', 1),
    last_name = nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '')
  where id = ident
    and (
      name is distinct from full_name
      or first_name is distinct from split_part(full_name, ' ', 1)
      or last_name is distinct from nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '')
    );
  return new;
end;
$$;

revoke all on function public.copy_seller_name_to_identity() from public, anon, authenticated;

drop trigger if exists store_seller_copy_name on public.store_seller;
create trigger store_seller_copy_name
  after insert or update of name, membership_id on public.store_seller
  for each row
  execute function public.copy_seller_name_to_identity();

-- A própria pessoa não troca o nome quando o acesso é de vendedor. service_role (sync) continua atualizando.
create or replace function public.keep_seller_identity_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;
  if exists (
    select 1
    from public.membership m
    where m.identity_id = new.id
      and m.role = 'SELLER'
      and m.status in ('PENDING', 'ACTIVE', 'SUSPENDED')
  ) then
    new.name := old.name;
    new.first_name := old.first_name;
    new.last_name := old.last_name;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_seller_identity_name() from public, anon, authenticated;

drop trigger if exists identity_keep_seller_name on public.identity;
create trigger identity_keep_seller_name
  before update on public.identity
  for each row
  execute function public.keep_seller_identity_name();

-- Quem já digitou outro nome no acesso passa a ver o nome da equipe.
update public.identity i
set
  name = picked.name,
  first_name = split_part(picked.name, ' ', 1),
  last_name = nullif(btrim(substr(picked.name, length(split_part(picked.name, ' ', 1)) + 1)), '')
from (
  select distinct on (m.identity_id)
    m.identity_id,
    btrim(s.name) as name
  from public.store_seller s
  join public.membership m on m.id = s.membership_id
  where m.role = 'SELLER'
    and length(btrim(s.name)) > 0
  order by m.identity_id, s.synced_at desc nulls last
) picked
where i.id = picked.identity_id
  and (
    i.name is distinct from picked.name
    or i.first_name is distinct from split_part(picked.name, ' ', 1)
    or i.last_name is distinct from nullif(btrim(substr(picked.name, length(split_part(picked.name, ' ', 1)) + 1)), '')
  );
