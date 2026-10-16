alter table public.employee_document
  drop constraint if exists employee_document_status_check;

alter table public.employee_document
  add constraint employee_document_status_check
  check (status in ('UNASSIGNED', 'PENDING', 'SIGNED', 'DECLINED', 'EXPIRED', 'ARCHIVED', 'EXTERNAL_SIGNED'));

comment on column public.employee_document.status is
  'UNASSIGNED e PENDING aguardam envio ou assinatura. SIGNED, DECLINED e EXPIRED vêm do Assina AI. ARCHIVED não pede assinatura. EXTERNAL_SIGNED entrou já assinado, fora da WDash.';
