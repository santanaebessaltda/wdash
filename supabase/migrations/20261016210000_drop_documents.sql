-- Documentos saiu. Some o que só existia para a assinatura.
delete from storage.objects where bucket_id = 'documents';
delete from storage.buckets where id = 'documents';

drop table if exists public.employee_document;
drop table if exists public.document_batch;
drop table if exists public.document_event;
drop table if exists public.assina_credential;

revoke update (cpf, email, whatsapp) on public.store_seller from authenticated;

alter table public.store_seller drop column if exists cpf;
alter table public.store_seller drop column if exists whatsapp;
alter table public.identity drop column if exists whatsapp;

comment on column public.store_seller.email is
  'E-mail do convite de acesso do vendedor. O sync de vendedores não grava esta coluna.';
