-- ICMS e ICMS ST por marca. O percentual único antigo vale para as duas,
-- para o lucro bruto não mudar até o gestor ajustar a WPINK.

alter table public.store
  add column if not exists icms_wepink_pct numeric(5, 2),
  add column if not exists icms_wpink_pct numeric(5, 2),
  add column if not exists icms_st_wepink_pct numeric(5, 2),
  add column if not exists icms_st_wpink_pct numeric(5, 2);

update public.store
set
  icms_wepink_pct = coalesce(icms_wepink_pct, icms_pct),
  icms_wpink_pct = coalesce(icms_wpink_pct, icms_pct),
  icms_st_wepink_pct = coalesce(icms_st_wepink_pct, icms_st_pct),
  icms_st_wpink_pct = coalesce(icms_st_wpink_pct, icms_st_pct);

alter table public.store drop constraint if exists store_tax_pct_range;
alter table public.store
  add constraint store_tax_pct_range check (
    coalesce(icms_pct, 0) between 0 and 100
    and coalesce(icms_st_pct, 0) between 0 and 100
    and coalesce(icms_wepink_pct, 0) between 0 and 100
    and coalesce(icms_wpink_pct, 0) between 0 and 100
    and coalesce(icms_st_wepink_pct, 0) between 0 and 100
    and coalesce(icms_st_wpink_pct, 0) between 0 and 100
  );

comment on column public.store.icms_wepink_pct is '% ICMS sobre o faturamento WEPINK.';
comment on column public.store.icms_wpink_pct is '% ICMS sobre o faturamento WPINK.';
comment on column public.store.icms_st_wepink_pct is '% ICMS ST sobre o CMV WEPINK.';
comment on column public.store.icms_st_wpink_pct is '% ICMS ST sobre o CMV WPINK.';

grant update (icms_wepink_pct, icms_wpink_pct, icms_st_wepink_pct, icms_st_wpink_pct) on public.store to authenticated;
