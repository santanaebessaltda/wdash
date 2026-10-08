-- Apagar usuario no Auth (ou ultimo membership) limpa a empresa vazia.
-- Auth → identity (ON DELETE CASCADE) → membership (ON DELETE CASCADE).
-- Se o tenant ficar sem nenhum membership, apaga o tenant (lojas/ERP/vendas ja
-- cascateiam a partir do tenant).

create or replace function public.delete_orphan_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.membership m where m.tenant_id = old.tenant_id
  ) then
    delete from public.tenant where id = old.tenant_id;
  end if;
  return old;
end;
$$;

drop trigger if exists membership_delete_orphan_tenant on public.membership;
create trigger membership_delete_orphan_tenant
  after delete on public.membership
  for each row
  execute function public.delete_orphan_tenant();

-- Residuos de testes (empresa sem ninguem)
delete from public.tenant t
where not exists (
  select 1 from public.membership m where m.tenant_id = t.id
);
