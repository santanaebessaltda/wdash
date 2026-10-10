-- Preferência de push do gestor/gerente e memória do que já foi avisado.
-- Sem a linha, o worker usa o padrão: vendas, fechamento e meta da loja ligados; período sem venda desligado.

create table if not exists public.notification_pref (
  auth_user_id uuid not null,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  sales boolean not null default true,
  quiet boolean not null default false,
  cash_close boolean not null default true,
  store_goal boolean not null default true,
  primary key (auth_user_id, tenant_id)
);

comment on table public.notification_pref is
  'Quais pushes o gestor ou gerente quer receber. O worker lê com service_role.';

alter table public.notification_pref enable row level security;

grant select, insert, update on public.notification_pref to authenticated;
grant select, insert, update, delete on public.notification_pref to service_role;

drop policy if exists notification_pref_own on public.notification_pref;
create policy notification_pref_own
  on public.notification_pref for all
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- kind + subject: store_goal = id da meta; cash_close = dia (YYYY-MM-DD).
-- level guarda o último nível avisado (meta) ou 1 depois do fechamento do dia.
create table if not exists public.notification_mark (
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  kind text not null check (kind in ('store_goal', 'cash_close')),
  subject text not null,
  level integer not null default 0,
  primary key (tenant_id, kind, subject)
);

comment on table public.notification_mark is
  'Último aviso enviado, para a rodada seguinte não repetir a mesma meta ou o mesmo fechamento.';

alter table public.notification_mark enable row level security;

grant select, insert, update, delete on public.notification_mark to service_role;
