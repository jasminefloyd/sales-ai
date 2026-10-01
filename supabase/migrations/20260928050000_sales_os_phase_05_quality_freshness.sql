-- Sales OS Audience Intelligence Phase 5: audience quality and freshness.

alter table public.sales_os_jobs
  drop constraint if exists sales_os_jobs_job_type_check;

alter table public.sales_os_jobs
  add constraint sales_os_jobs_job_type_check
  check (job_type in (
    'product_analysis',
    'audience_discovery',
    'audience_enrichment',
    'audience_quality',
    'find',
    'engagement_batch',
    'learning_analysis',
    'attribution',
    'console_action'
  ));

alter table public.sales_os_audiences
  add column if not exists quality_state text not null default 'needs_enrichment'
    check (quality_state in ('ready', 'needs_enrichment', 'stale', 'low_confidence', 'suppressed', 'blocked')),
  add column if not exists quality_score numeric(8, 4)
    check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  add column if not exists quality_last_calculated_at timestamptz,
  add column if not exists quality_calculation_version text;

create table if not exists public.sales_os_audience_quality_rollups (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  icp_id uuid not null,
  audience_id uuid not null,
  definition_id uuid not null,
  member_count integer not null default 0 check (member_count >= 0),
  ready_count integer not null default 0 check (ready_count >= 0),
  stale_count integer not null default 0 check (stale_count >= 0),
  missing_data_count integer not null default 0 check (missing_data_count >= 0),
  low_confidence_count integer not null default 0 check (low_confidence_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  quality_score numeric(8, 4) check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  readiness_state text not null default 'needs_enrichment'
    check (readiness_state in ('ready', 'needs_enrichment', 'stale', 'low_confidence', 'suppressed', 'blocked')),
  reasons jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now(),
  calculation_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, definition_id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id) references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, definition_id) references public.sales_os_audience_definitions (tenant_id, id) on delete cascade
);

create index if not exists sales_os_audience_quality_rollups_scope_idx
  on public.sales_os_audience_quality_rollups (tenant_id, product_id, readiness_state, calculated_at desc);

create or replace function public.sales_os_member_activation_ready(
  p_tenant_id text,
  p_member_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.sales_os_audience_members member
    left join public.sales_os_contacts contact
      on contact.tenant_id = member.tenant_id
     and contact.id = member.contact_id
    left join public.sales_os_audience_quality_snapshots quality
      on quality.tenant_id = member.tenant_id
     and quality.member_id = member.id
     and quality.is_current = true
    where member.tenant_id = p_tenant_id
      and member.id = p_member_id
      and member.status = 'ready'
      and member.suppression_state = 'clear'
      and member.consent_state not in ('restricted', 'revoked')
      and quality.readiness_state = 'ready'
      and contact.email_verification_status = 'valid'
  );
$$;

create or replace function public.sales_os_set_workflow_job_stage()
returns trigger
language plpgsql
as $$
begin
  new.workflow_stage := case new.job_type
    when 'product_analysis' then 'product'
    when 'audience_discovery' then 'audience'
    when 'audience_enrichment' then 'diagnostics'
    when 'audience_quality' then 'diagnostics'
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

comment on table public.sales_os_audience_quality_rollups is
  'Audience-level operational quality rollups separate from strategic evidence scoring.';
comment on function public.sales_os_member_activation_ready(text, uuid) is
  'Hard gate requiring current quality readiness, valid email, consent, and suppression clearance.';
