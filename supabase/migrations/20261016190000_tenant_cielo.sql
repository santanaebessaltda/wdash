-- Acesso Cielo da empresa. Cada franqueado grava o seu. O worker decifra na hora de buscar.
-- O estabelecimento de cada filial continua em store_cielo.

create table if not exists public.tenant_cielo (
  tenant_id uuid primary key references public.tenant (id) on delete cascade,
  merchant_code text not null,
  client_id text not null,
  secret_ciphertext text not null,
  hmac_ciphertext text not null,
  cert_ciphertext text not null,
  key_ciphertext text not null,
  constraint tenant_cielo_merchant_trim check (length(btrim(merchant_code)) = 10),
  constraint tenant_cielo_client_trim check (length(btrim(client_id)) > 0)
);

comment on table public.tenant_cielo is
  'Aplicação Cielo da empresa (matriz, client id e segredos cifrados). Uma por franqueado.';
comment on column public.tenant_cielo.secret_ciphertext is
  'AES-GCM do client secret. Só service_role.';
comment on column public.tenant_cielo.hmac_ciphertext is
  'AES-GCM da chave HMAC (header X-Signature). Só service_role.';
comment on column public.tenant_cielo.cert_ciphertext is
  'AES-GCM do certificado .cer. Só service_role.';
comment on column public.tenant_cielo.key_ciphertext is
  'AES-GCM da chave privada .key. Só service_role.';

alter table public.tenant_cielo enable row level security;

grant select, insert, update, delete on public.tenant_cielo to service_role;
grant select (tenant_id, merchant_code, client_id) on public.tenant_cielo to authenticated;

drop policy if exists tenant_cielo_select_own on public.tenant_cielo;
create policy tenant_cielo_select_own
  on public.tenant_cielo for select
  to authenticated
  using (tenant_id in (select public.staff_tenant_ids()));
