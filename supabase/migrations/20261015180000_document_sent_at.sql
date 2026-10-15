alter table public.employee_document
  add column if not exists sent_at timestamptz;

-- Envios anteriores não gravavam o horário. A data de criação é o que existe.
update public.employee_document
  set sent_at = created_at
  where envelope_id is not null
    and sent_at is null;

comment on column public.employee_document.sent_at is
  'Quando o envelope foi criado. Documentos anteriores usam created_at.';
