-- CPF, e-mail e WhatsApp são da WDash, como o grupo. O sync do Millennium não grava estas colunas.
comment on column public.store_seller.email is
  'E-mail preenchido na WDash. O sync de vendedores não grava esta coluna.';

comment on column public.store_seller.whatsapp is
  'WhatsApp só dígitos, preenchido na WDash. O sync de vendedores não grava esta coluna.';

grant update (cpf, email, whatsapp) on public.store_seller to authenticated;
