-- A policy de leitura usava `name` dentro do join com identity.
-- O Postgres ligou essa coluna em identity.name (o nome da pessoa), não no caminho do arquivo.
-- O upload passava; a URL assinada não, e o vídeo não abria.

drop policy if exists help_videos_select on storage.objects;
create policy help_videos_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'help-videos'
    and exists (
      select 1
      from public.help_video v
      join public.membership m on m.tenant_id = v.tenant_id
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and v.tenant_id::text = (storage.foldername(objects.name))[1]
        and v.id::text = (storage.foldername(objects.name))[2]
        and (
          m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
          or (v.visible and m.role = any (v.audiences))
        )
    )
  );
