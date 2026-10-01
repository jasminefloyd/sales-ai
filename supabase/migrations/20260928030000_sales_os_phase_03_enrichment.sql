-- Sales OS Audience Intelligence Phase 3: account/contact enrichment lifecycle.

alter table public.sales_os_jobs
  drop constraint if exists sales_os_jobs_job_type_check;

alter table public.sales_os_jobs
  add constraint sales_os_jobs_job_type_check
  check (job_type in (
    'product_analysis',
    'audience_discovery',
    'audience_enrichment',
    'find',
    'engagement_batch',
    'learning_analysis',
    'attribution',
    'console_action'
  ));

alter table public.sales_os_accounts
  add column if not exists enrichment_status text not null default 'not_started'
    check (enrichment_status in ('not_started', 'queued', 'running', 'succeeded', 'partial', 'failed', 'stale')),
  add column if not exists last_enriched_at timestamptz,
  add column if not exists enrichment_error text;

alter table public.sales_os_contacts
  add column if not exists enrichment_status text not null default 'not_started'
    check (enrichment_status in ('not_started', 'queued', 'running', 'succeeded', 'partial', 'failed', 'stale')),
  add column if not exists last_enriched_at timestamptz,
  add column if not exists enrichment_error text;

alter table public.sales_os_enrichment_records
  add column if not exists job_id uuid,
  add column if not exists attempt integer not null default 1 check (attempt > 0),
  add column if not exists missing_fields jsonb not null default '[]'::jsonb,
  add column if not exists latency_ms integer,
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_enrichment_records_job_fk'
      and conrelid = 'public.sales_os_enrichment_records'::regclass
  ) then
    alter table public.sales_os_enrichment_records
      add constraint sales_os_enrichment_records_job_fk
      foreign key (tenant_id, job_id)
      references public.sales_os_jobs (tenant_id, id) on delete set null;
  end if;
end $$;

create index if not exists sales_os_accounts_enrichment_status_idx
  on public.sales_os_accounts (tenant_id, product_id, enrichment_status, last_enriched_at);
create index if not exists sales_os_contacts_enrichment_status_idx
  on public.sales_os_contacts (tenant_id, product_id, enrichment_status, last_enriched_at);
create index if not exists sales_os_enrichment_records_job_idx
  on public.sales_os_enrichment_records (tenant_id, job_id, status, created_at desc);

comment on column public.sales_os_accounts.enrichment_status is
  'Operational enrichment state; strategic audience fit is stored separately.';
comment on column public.sales_os_contacts.enrichment_status is
  'Operational enrichment state; email verification remains explicit and separate.';
comment on column public.sales_os_enrichment_records.missing_fields is
  'Fields still unavailable after this enrichment attempt; prior verified values are retained.';

-- Keep Phase 3 jobs visible in the existing workflow telemetry without adding a
-- new user-facing workflow stage.
create or replace function public.sales_os_set_workflow_job_stage()
returns trigger
language plpgsql
as $$
begin
  new.workflow_stage := case new.job_type
    when 'product_analysis' then 'product'
    when 'audience_discovery' then 'audience'
    when 'audience_enrichment' then 'diagnostics'
    when 'find' then 'find'
    when 'engagement_batch' then 'engage'
    when 'learning_analysis' then 'learn'
    when 'attribution' then 'learn'
    when 'console_action' then 'diagnostics'
    else coalesce(new.workflow_stage, 'diagnostics')
  end;
  return new;
end;
$$;
