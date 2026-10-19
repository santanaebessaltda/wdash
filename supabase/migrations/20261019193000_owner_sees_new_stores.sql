-- O onboarding gravou no gestor só as filiais da primeira conta Millennium.
-- Filial de uma conta conectada depois ficava de fora do seletor.
-- Vínculo vazio continua significando todas (não preenche).

insert into public.membership_store (membership_id, store_id)
select m.id, s.id
from public.membership m
join public.store s on s.tenant_id = m.tenant_id and s.active
where m.role in ('OWNER', 'ADMIN_GLOBAL')
  and m.status = 'ACTIVE'
  and exists (
    select 1 from public.membership_store ms where ms.membership_id = m.id
  )
on conflict (membership_id, store_id) do nothing;
