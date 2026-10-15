-- Prazo, lembrete e signatário extra passam a ser de cada documento.
alter table public.employee_document
  add column if not exists deadline date,
  add column if not exists reminder text,
  add column if not exists extra_signer jsonb;

alter table public.employee_document
  drop constraint if exists employee_document_reminder_check;

alter table public.employee_document
  add constraint employee_document_reminder_check
  check (reminder is null or reminder in ('EVERY_DAY', 'EVERY_3_DAYS', 'EVERY_WEEK', 'NEVER'));

comment on column public.employee_document.deadline is
  'Prazo deste documento. Vazio não bloqueia o envio.';

comment on column public.employee_document.reminder is
  'Lembrete deste documento. O assistente copia o último valor para o documento seguinte.';

comment on column public.employee_document.extra_signer is
  'Signatário extra deste documento. Não é colaborador e o sync não mexe nesta coluna.';
