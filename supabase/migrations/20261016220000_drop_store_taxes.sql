-- ICMS e ICMS ST saem da filial. O lucro bruto é faturamento − CMV.

alter table public.store drop constraint if exists store_tax_pct_range;

alter table public.store
  drop column if exists icms_pct,
  drop column if exists icms_st_pct,
  drop column if exists icms_wepink_pct,
  drop column if exists icms_wpink_pct,
  drop column if exists icms_st_wepink_pct,
  drop column if exists icms_st_wpink_pct;
