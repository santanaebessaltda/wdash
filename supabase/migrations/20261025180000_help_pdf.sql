-- Guia prático também aceita PDF no mesmo bucket e na mesma biblioteca.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'help_video'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%mime_type%';

  if constraint_name is not null then
    execute format('alter table public.help_video drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.help_video
  add constraint help_video_mime_type_check
  check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime', 'application/pdf'));

update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'application/pdf']
where id = 'help-videos';
