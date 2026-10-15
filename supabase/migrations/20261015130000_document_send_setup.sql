-- Canal e marcas por documento. O canal do lote deixa de mandar no envio.
alter table public.employee_document
  add column if not exists channel text,
  add column if not exists marks jsonb not null default '[]'::jsonb;

alter table public.employee_document
  drop constraint if exists employee_document_channel_check;

alter table public.employee_document
  add constraint employee_document_channel_check
  check (channel is null or channel in ('EMAIL', 'WHATSAPP'));

comment on column public.employee_document.channel is
  'Canal deste documento. O envio lê esta coluna, não document_batch.channel.';

comment on column public.employee_document.marks is
  'Marcas de assinatura em percentual: pageNumber, x, y e element SIGNATURE.';

alter table public.document_batch
  add column if not exists extra_signer jsonb;

comment on column public.document_batch.extra_signer is
  'Signatário extra opcional do lote. Não é um colaborador e o sync não mexe nesta coluna.';
