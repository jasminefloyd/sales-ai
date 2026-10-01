-- Sales OS Audience Intelligence Phase 10: reusable, refreshable definitions.

alter table public.sales_os_jobs drop constraint if exists sales_os_jobs_job_type_check;
alter table public.sales_os_jobs add constraint sales_os_jobs_job_type_check
  check (job_type in (
    'product_analysis', 'audience_discovery', 'audience_enrichment',
    'audience_quality', 'audience_intent', 'audience_refresh', 'find',
    'engagement_batch', 'learning_analysis', 'attribution', 'console_action',
    'activation_sync'
  ));

-- Keep the workflow stage aligned with the later Phase 6 trigger. The repair
-- migration 20260929110000 is also provided for environments that already
-- applied this migration before this correction.
alter table public.sales_os_jobs
  drop constraint if exists sales_os_jobs_workflow_stage_check;
alter table public.sales_os_jobs
  add constraint sales_os_jobs_workflow_stage_check
  check (workflow_stage in (
    'product_input', 'profile_review', 'strategy_generation',
    'outreach_review', 'copy_generation',
    'product', 'audience', 'find', 'engage', 'learn', 'diagnostics'
  ));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_audience_definitions_rule_object_check'
      and conrelid = 'public.sales_os_audience_definitions'::regclass
  ) then
    alter table public.sales_os_audience_definitions
      add constraint sales_os_audience_definitions_rule_object_check
      check (jsonb_typeof(rule_definition) = 'object');
  end if;
end $$;

create table if not exists public.sales_os_audience_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  icp_id uuid not null,
  audience_id uuid not null,
  definition_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  preview_only boolean not null default false,
  total_evaluated integer not null default 0 check (total_evaluated >= 0),
  added_count integer not null default 0 check (added_count >= 0),
  removed_count integer not null default 0 check (removed_count >= 0),
  retained_count integer not null default 0 check (retained_count >= 0),
  error_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id) references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, definition_id) references public.sales_os_audience_definitions (tenant_id, id) on delete cascade
);

create table if not exists public.sales_os_audience_membership_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  audience_id uuid not null,
  definition_id uuid not null,
  refresh_run_id uuid not null,
  member_id uuid,
  change_type text not null check (change_type in ('added', 'removed', 'retained')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, definition_id) references public.sales_os_audience_definitions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, refresh_run_id) references public.sales_os_audience_refresh_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.sales_os_audience_members (tenant_id, id) on delete set null
);

create index if not exists sales_os_audience_refresh_runs_scope_idx
  on public.sales_os_audience_refresh_runs (tenant_id, product_id, audience_id, created_at desc);
create index if not exists sales_os_audience_membership_changes_run_idx
  on public.sales_os_audience_membership_changes (tenant_id, refresh_run_id, change_type);

alter table public.sales_os_audience_refresh_runs enable row level security;
drop policy if exists sales_os_audience_refresh_runs_select on public.sales_os_audience_refresh_runs;
create policy sales_os_audience_refresh_runs_select on public.sales_os_audience_refresh_runs
  for select using (tenant_id = 'sales_os' and auth.uid() is not null);
alter table public.sales_os_audience_membership_changes enable row level security;
drop policy if exists sales_os_audience_membership_changes_select on public.sales_os_audience_membership_changes;
create policy sales_os_audience_membership_changes_select on public.sales_os_audience_membership_changes
  for select using (tenant_id = 'sales_os' and auth.uid() is not null);

comment on column public.sales_os_audience_definitions.rule_definition is
  'Versioned deterministic JSON rule document. Supported initial operators: equals, contains, exists, in.';
