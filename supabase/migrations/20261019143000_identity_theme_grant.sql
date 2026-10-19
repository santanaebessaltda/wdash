-- Meu perfil > Aparência. A coluna entrou sem GRANT UPDATE; o authenticated
-- só pode alterar as colunas listadas, então Salvar alterações falhava.
grant update (theme_preference) on public.identity to authenticated;
