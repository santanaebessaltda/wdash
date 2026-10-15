alter table public.employee_document
  add column if not exists removed_at timestamptz;

comment on column public.employee_document.removed_at is
  'Preenchido quando o gestor exclui o documento. A linha e o PDF ficam para auditoria e somem das listas do WDash. A assinatura no Assina AI é cancelada.';

create index if not exists employee_document_visible_idx
  on public.employee_document (tenant_id, created_at)
  where removed_at is null;
