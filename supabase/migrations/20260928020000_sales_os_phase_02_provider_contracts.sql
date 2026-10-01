-- Sales OS Audience Intelligence Phase 2: provider-neutral contracts.
-- Extends provider/run metadata without storing credentials or changing the
-- existing provider capability rows used by the current workflow.

alter table public.sales_os_providers
  add column if not exists health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'degraded', 'unavailable')),
  add column if not exists timeout_ms integer not null default 30000
    check (timeout_ms > 0),
  add column if not exists failure_count integer not null default 0
    check (failure_count >= 0),
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists health_metadata jsonb not null default '{}'::jsonb;

alter table public.sales_os_provider_runs
  add column if not exists retryable boolean,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists request_hash text,
  add column if not exists provenance jsonb not null default '[]'::jsonb;

create index if not exists sales_os_providers_capability_health_idx
  on public.sales_os_providers (tenant_id, capability, enabled, health_status, priority);
create index if not exists sales_os_provider_runs_provider_status_idx
  on public.sales_os_provider_runs (tenant_id, provider_id, status, started_at desc);
create index if not exists sales_os_provider_runs_request_hash_idx
  on public.sales_os_provider_runs (tenant_id, request_hash)
  where request_hash is not null;

comment on column public.sales_os_providers.health_metadata is
  'Non-secret provider health details such as last error category and health-check metadata.';
comment on column public.sales_os_provider_runs.provenance is
  'Provider-neutral source records and timestamps returned by the capability contract.';
