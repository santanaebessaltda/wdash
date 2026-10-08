-- Loja desativada continua no banco e sai da operação (seletor, análises, sync).
comment on column public.store.active is
  'false = desativada: fora do seletor, das análises, dos Primeiros passos e da sincronização. O cadastro permanece.';

grant update (active) on public.store to authenticated;
