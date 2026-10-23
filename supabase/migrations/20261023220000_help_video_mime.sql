-- O arquivo subia sem o tipo do vídeo, e o navegador não dava play.
update storage.objects as object
set metadata = jsonb_set(coalesce(object.metadata, '{}'::jsonb), '{mimetype}', to_jsonb(video.mime_type), true)
from public.help_video as video
where object.bucket_id = 'help-videos'
  and object.name = video.storage_path
  and coalesce(object.metadata ->> 'mimetype', '') is distinct from video.mime_type;

update storage.objects as object
set metadata = jsonb_set(coalesce(object.metadata, '{}'::jsonb), '{mimetype}', '"image/jpeg"'::jsonb, true)
from public.help_video as video
where object.bucket_id = 'help-videos'
  and video.poster_path is not null
  and object.name = video.poster_path
  and coalesce(object.metadata ->> 'mimetype', '') is distinct from 'image/jpeg';
