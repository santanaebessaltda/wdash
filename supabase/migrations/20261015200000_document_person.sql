-- Documento de um Gestor ou Gerente da WDash. O colaborador do Millennium continua em seller_id.
alter table public.employee_document
  add column if not exists identity_id uuid references public.identity (id) on delete set null;

comment on column public.employee_document.identity_id is
  'Pessoa da WDash quando o documento não é de um colaborador do Millennium. A filial continua em store_id.';

create index if not exists employee_document_identity_idx
  on public.employee_document (tenant_id, identity_id)
  where identity_id is not null;

-- Contato de envio. O cadastro de acesso não pede celular; o WhatsApp entra só aqui, na preparação do documento.
alter table public.identity
  add column if not exists whatsapp text;

comment on column public.identity.whatsapp is
  'WhatsApp só dígitos, preenchido no envio de documentos. O cadastro de acesso não pede celular.';
