-- Sales OS Audience Intelligence Phase 9: human-approved activation.

alter table public.sales_os_jobs
  drop constraint if exists sales_os_jobs_job_type_check;
alter table public.sales_os_jobs
  add constraint sales_os_jobs_job_type_check
  check (job_type in (
    'product_analysis', 'audience_discovery', 'audience_enrichment',
    'audience_quality', 'audience_intent', 'find', 'engagement_batch',
    'learning_analysis', 'attribution', 'console_action', 'activation_sync'
  ));

create table if not exists public.sales_os_activation_destinations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  destination_type text not null check (destination_type in ('csv', 'webhook', 'crm')),
  connector_key text not null default 'generic',
  name text not null,
  endpoint_url text,
  secret_ref text,
  public_config jsonb not null default '{}'::jsonb,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  credential_version integer not null default 1 check (credential_version > 0),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, name),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

alter table public.sales_os_audience_activations
  add column if not exists destination_id uuid,
  add column if not exists field_mapping jsonb not null default '{}'::jsonb,
  add column if not exists sync_mode text not null default 'full'
    check (sync_mode in ('full', 'incremental', 'retry')),
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_activation_destination_fk'
      and conrelid = 'public.sales_os_audience_activations'::regclass
  ) then
    alter table public.sales_os_audience_activations
      add constraint sales_os_activation_destination_fk
      foreign key (tenant_id, destination_id)
      references public.sales_os_activation_destinations (tenant_id, id) on delete restrict;
  end if;
end $$;

alter table public.sales_os_activation_sync_runs
  add column if not exists export_content text,
  add column if not exists error_summary jsonb not null default '{}'::jsonb,
  add column if not exists completed_at timestamptz;

create index if not exists sales_os_activation_destinations_product_idx
  on public.sales_os_activation_destinations (tenant_id, product_id, status);
create index if not exists sales_os_activations_destination_idx
  on public.sales_os_audience_activations (tenant_id, product_id, destination_id, status);

alter table public.sales_os_activation_destinations enable row level security;
drop policy if exists sales_os_activation_destinations_select on public.sales_os_activation_destinations;
create policy sales_os_activation_destinations_select on public.sales_os_activation_destinations
  for select using (tenant_id = 'sales_os' and auth.uid() is not null);
drop policy if exists sales_os_activation_destinations_insert on public.sales_os_activation_destinations;
create policy sales_os_activation_destinations_insert on public.sales_os_activation_destinations
  for insert with check (tenant_id = 'sales_os' and auth.uid() is not null);
drop policy if exists sales_os_activation_destinations_update on public.sales_os_activation_destinations;
create policy sales_os_activation_destinations_update on public.sales_os_activation_destinations
  for update using (tenant_id = 'sales_os' and auth.uid() is not null)
  with check (tenant_id = 'sales_os' and auth.uid() is not null);

comment on table public.sales_os_activation_destinations is
  'Product-scoped activation connections. secret_ref points to an Edge Function secret; raw credentials never enter browser payloads.';
comment on column public.sales_os_audience_activations.field_mapping is
  'Destination field mapping reviewed before activation approval.';
