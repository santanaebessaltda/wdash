alter table public.employee_document
  add column if not exists signers jsonb;

comment on column public.employee_document.signers is
  'Andamento de cada signatário: nome, ordem, recipient do Assina AI, canal e status.';
