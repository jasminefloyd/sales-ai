-- Sales OS Phase 14: retain non-secret AI execution provenance.

alter table public.sales_os_provider_runs
  add column if not exists prompt_version text,
  add column if not exists model_identifier text;

comment on column public.sales_os_provider_runs.prompt_version is
  'Version of the source-controlled prompt/context contract; never contains prompt secrets.';
comment on column public.sales_os_provider_runs.model_identifier is
  'Provider model identifier used for the run; never contains credentials.';
