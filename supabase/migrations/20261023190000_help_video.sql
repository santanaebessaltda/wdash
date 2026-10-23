-- Ajuda: vídeos da empresa. Gestor e gerente administram a biblioteca inteira.
-- Quem assiste só lê o que está visível e no próprio papel (Equipe, Gerente ou Gestor).
-- Oculto permanece na biblioteca. A visualização conta no play, uma linha por pessoa.

create table if not exists public.help_video (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  title text not null check (length(trim(title)) > 0 and length(title) <= 120),
  description text not null default '' check (length(description) <= 2000),
  audiences text[] not null check (
    cardinality(audiences) > 0
    and audiences <@ array['OWNER', 'MANAGER', 'SELLER']::text[]
  ),
  visible boolean not null default true,
  storage_path text not null,
  poster_path text,
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  mime_type text not null check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists help_video_tenant_created_idx
  on public.help_video (tenant_id, created_at desc);

create table if not exists public.help_video_view (
  video_id uuid not null references public.help_video (id) on delete cascade,
  identity_id uuid not null references public.identity (id) on delete cascade,
  watched_at timestamptz not null default now(),
  primary key (video_id, identity_id)
);

comment on table public.help_video is
  'Vídeos da Ajuda. audiences = OWNER (Gestor), MANAGER (Gerentes), SELLER (Equipe). visible = false oculta de quem só assiste.';

alter table public.help_video enable row level security;
alter table public.help_video_view enable row level security;

grant select, insert, update, delete on public.help_video to authenticated, service_role;
grant select on public.help_video_view to authenticated, service_role;

create or replace function public.touch_help_video()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists help_video_touch on public.help_video;
create trigger help_video_touch
  before update on public.help_video
  for each row execute function public.touch_help_video();

drop policy if exists help_video_select on public.help_video;
create policy help_video_select
  on public.help_video for select
  to authenticated
  using (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.tenant_id = help_video.tenant_id
        and m.status = 'ACTIVE'
        and (
          m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
          or (help_video.visible and m.role = any (help_video.audiences))
        )
    )
  );

drop policy if exists help_video_write on public.help_video;
create policy help_video_write
  on public.help_video for all
  to authenticated
  using (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.tenant_id = help_video.tenant_id
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  )
  with check (
    exists (
      select 1
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.tenant_id = help_video.tenant_id
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists help_video_view_select on public.help_video_view;
create policy help_video_view_select
  on public.help_video_view for select
  to authenticated
  using (
    exists (
      select 1
      from public.help_video v
      join public.membership m on m.tenant_id = v.tenant_id
      join public.identity i on i.id = m.identity_id
      where v.id = help_video_view.video_id
        and i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

-- Pessoas ativas da empresa, para a lista "quem viu". Só gestor e gerente.
create or replace function public.help_audience(p_tenant_id uuid)
returns table (
  identity_id uuid,
  name text,
  role text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.name, m.role
  from public.membership m
  join public.identity i on i.id = m.identity_id
  where m.tenant_id = p_tenant_id
    and m.status = 'ACTIVE'
    and m.role in ('OWNER', 'MANAGER', 'SELLER', 'ADMIN_GLOBAL')
    and length(trim(i.name)) > 0
    and exists (
      select 1
      from public.membership me
      join public.identity ie on ie.id = me.identity_id
      where ie.auth_user_id = auth.uid()
        and me.tenant_id = p_tenant_id
        and me.status = 'ACTIVE'
        and me.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    );
$$;

revoke all on function public.help_audience(uuid) from public, anon;
grant execute on function public.help_audience(uuid) to authenticated, service_role;

-- Marca o play da própria pessoa, se ela pode abrir o vídeo.
create or replace function public.mark_help_video_watched(p_video_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.help_video%rowtype;
  v_identity uuid;
  v_role text;
begin
  select * into v from public.help_video where id = p_video_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;

  select i.id, m.role into v_identity, v_role
  from public.identity i
  join public.membership m on m.identity_id = i.id
  where i.auth_user_id = auth.uid()
    and m.tenant_id = v.tenant_id
    and m.status = 'ACTIVE';

  if v_identity is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_role not in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL') then
    if not v.visible or not (v_role = any (v.audiences)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  insert into public.help_video_view (video_id, identity_id, watched_at)
  values (p_video_id, v_identity, now())
  on conflict (video_id, identity_id) do update
    set watched_at = excluded.watched_at;
end;
$$;

revoke all on function public.mark_help_video_watched(uuid) from public, anon;
grant execute on function public.mark_help_video_watched(uuid) to authenticated, service_role;

-- Bucket privado. A policy só entrega o arquivo de um vídeo que a pessoa pode ver.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'help-videos',
  'help-videos',
  false,
  209715200,
  array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

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
        and v.tenant_id::text = (storage.foldername(name))[1]
        and v.id::text = (storage.foldername(name))[2]
        and (
          m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
          or (v.visible and m.role = any (v.audiences))
        )
    )
  );

drop policy if exists help_videos_insert on storage.objects;
create policy help_videos_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'help-videos'
    and (storage.foldername(name))[1] in (
      select m.tenant_id::text
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );

drop policy if exists help_videos_delete on storage.objects;
create policy help_videos_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'help-videos'
    and (storage.foldername(name))[1] in (
      select m.tenant_id::text
      from public.membership m
      join public.identity i on i.id = m.identity_id
      where i.auth_user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'MANAGER', 'ADMIN_GLOBAL')
    )
  );
