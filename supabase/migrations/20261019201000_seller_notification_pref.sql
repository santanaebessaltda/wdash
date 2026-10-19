-- Avisos da vendedora. O desenho da tela é o mesmo do gestor; as linhas são as dela.
-- Sem a linha, o padrão é os quatro ligados. O envio ainda não sai na rodada.

alter table public.notification_pref
  add column if not exists seller_goal boolean not null default true,
  add column if not exists seller_challenge boolean not null default true,
  add column if not exists seller_wallet boolean not null default true,
  add column if not exists seller_near boolean not null default true;

comment on column public.notification_pref.seller_goal is
  'Push quando a vendedora alcança um novo nível da meta dela. Uma vez por nível.';
comment on column public.notification_pref.seller_challenge is
  'Push quando ela garante o prêmio do desafio e quando o desafio encerra.';
comment on column public.notification_pref.seller_wallet is
  'Push quando uma retirada ou uma quebra entra na carteira dela.';
comment on column public.notification_pref.seller_near is
  'Push quando falta pouco para o próximo nível. No máximo uma vez por meta.';

comment on table public.notification_pref is
  'Quais pushes a pessoa quer receber. Gestor e gerente: vendas, fechamento, meta da loja e estoque. Vendedor: nível da meta, desafio, carteira e perto do próximo nível. O worker lê com service_role.';

drop policy if exists push_subscription_insert_own on public.push_subscription;
create policy push_subscription_insert_own
  on public.push_subscription for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.tenant_id = push_subscription.tenant_id
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL', 'SELLER')
    )
  );
