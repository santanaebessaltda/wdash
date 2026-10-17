-- store só libera UPDATE coluna a coluna. Sem este grant, salvar o aluguel falha.

grant update (rent_seasons) on public.store to authenticated;
