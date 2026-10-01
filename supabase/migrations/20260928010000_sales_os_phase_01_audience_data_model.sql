-- Sales OS Audience Intelligence Phase 1: canonical audience data model.
-- This migration is additive. Existing product, ICP, audience, discovery,
-- approval, event, and outreach tables remain the compatibility layer.

create table if not exists public.sales_os_audience_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  icp_id uuid not null,
  audience_id uuid not null,
  version integer not null default 1 check (version > 0),
  definition_kind text not null default 'rule'
    check (definition_kind in ('rule', 'snapshot', 'manual')),
  name text not null,
  description text not null default '',
  rule_definition jsonb not null default '{}'::jsonb,
  source_system text not null default 'sales_os',
  source_record_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  freshness_at timestamptz not null default now(),
  confidence numeric(8, 4) not null default 0 check (confidence >= 0 and confidence <= 1),
  provenance jsonb not null default '[]'::jsonb,
  consent_state text not null default 'unknown'
    check (consent_state in ('unknown', 'permitted', 'restricted', 'revoked')),
  status text not null default 'draft'
    check (status in ('draft', 'proposed', 'approved', 'active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, audience_id, version),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id)
    references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id)
    references public.sales_os_audiences (tenant_id, id) on delete cascade
);

create table if not exists public.sales_os_audience_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  icp_id uuid not null,
  audience_id uuid not null,
  definition_id uuid not null,
  account_id uuid,
  contact_id uuid,
  identity_type text not null
    check (identity_type in ('company', 'person', 'pseudonymous', 'other')),
  external_entity_key text,
  source_system text not null,
  source_record_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  freshness_at timestamptz not null default now(),
  confidence numeric(8, 4) not null default 0 check (confidence >= 0 and confidence <= 1),
  provenance jsonb not null default '[]'::jsonb,
  consent_state text not null default 'unknown'
    check (consent_state in ('unknown', 'permitted', 'restricted', 'revoked')),
  suppression_state text not null default 'not_checked'
    check (suppression_state in ('not_checked', 'clear', 'suppressed')),
  status text not null default 'discovered'
    check (status in ('discovered', 'needs_enrichment', 'ready', 'stale', 'low_confidence', 'suppressed', 'blocked', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id)
    references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id)
    references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, definition_id)
    references public.sales_os_audience_definitions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id)
    references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, contact_id)
    references public.sales_os_contacts (tenant_id, id) on delete set null,
  check (
    num_nonnulls(account_id, contact_id)
      + case when nullif(trim(external_entity_key), '') is null then 0 else 1 end = 1
  )
);

create table if not exists public.sales_os_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  member_id uuid not null,
  candidate_account_id uuid,
  candidate_contact_id uuid,
  candidate_external_key text,
  candidate_type text not null
    check (candidate_type in ('company', 'person', 'pseudonymous', 'other')),
  confidence numeric(8, 4) not null check (confidence >= 0 and confidence <= 1),
  match_basis jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id)
    references public.sales_os_audience_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, candidate_account_id)
    references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, candidate_contact_id)
    references public.sales_os_contacts (tenant_id, id) on delete set null,
  check (
    num_nonnulls(candidate_account_id, candidate_contact_id)
      + case when nullif(trim(candidate_external_key), '') is null then 0 else 1 end >= 1
  )
);

create table if not exists public.sales_os_identity_merges (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  member_id uuid not null,
  candidate_id uuid,
  source_account_id uuid,
  source_contact_id uuid,
  target_account_id uuid,
  target_contact_id uuid,
  confidence numeric(8, 4) not null check (confidence >= 0 and confidence <= 1),
  merge_basis jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'reverted')),
  approved_by text,
  approved_at timestamptz,
  reverted_by text,
  reverted_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id)
    references public.sales_os_audience_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, candidate_id)
    references public.sales_os_identity_candidates (tenant_id, id) on delete set null,
  foreign key (tenant_id, source_account_id)
    references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, source_contact_id)
    references public.sales_os_contacts (tenant_id, id) on delete set null,
  foreign key (tenant_id, target_account_id)
    references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, target_contact_id)
    references public.sales_os_contacts (tenant_id, id) on delete set null,
  check (num_nonnulls(source_account_id, source_contact_id) = 1),
  check (num_nonnulls(target_account_id, target_contact_id) = 1)
);

create table if not exists public.sales_os_enrichment_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  member_id uuid not null,
  account_id uuid,
  contact_id uuid,
  entity_type text not null check (entity_type in ('company', 'contact')),
  provider_id uuid,
  provider_capability text not null,
  source_record_id text,
  status text not null default 'requested'
    check (status in ('requested', 'succeeded', 'partial', 'failed', 'stale')),
  data jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  confidence numeric(8, 4) not null default 0 check (confidence >= 0 and confidence <= 1),
  observed_at timestamptz not null default now(),
  freshness_at timestamptz not null default now(),
  expires_at timestamptz,
  request_reference text,
  error_code text,
  error_detail text,
  retryable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id)
    references public.sales_os_audience_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id)
    references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, contact_id)
    references public.sales_os_contacts (tenant_id, id) on delete set null,
  foreign key (tenant_id, provider_id)
    references public.sales_os_providers (tenant_id, id) on delete set null,
  check (num_nonnulls(account_id, contact_id) = 1),
  check (expires_at is null or expires_at >= observed_at)
);

create table if not exists public.sales_os_audience_quality_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  definition_id uuid not null,
  member_id uuid not null,
  strategic_fit_score numeric(8, 4) check (strategic_fit_score >= 0 and strategic_fit_score <= 1),
  identity_confidence_score numeric(8, 4) check (identity_confidence_score >= 0 and identity_confidence_score <= 1),
  contact_verification_score numeric(8, 4) check (contact_verification_score >= 0 and contact_verification_score <= 1),
  freshness_score numeric(8, 4) check (freshness_score >= 0 and freshness_score <= 1),
  quality_score numeric(8, 4) check (quality_score >= 0 and quality_score <= 1),
  readiness_state text not null
    check (readiness_state in ('ready', 'needs_enrichment', 'stale', 'low_confidence', 'suppressed', 'blocked')),
  reasons jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now(),
  calculation_version text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, definition_id)
    references public.sales_os_audience_definitions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id)
    references public.sales_os_audience_members (tenant_id, id) on delete cascade
);

create table if not exists public.sales_os_intent_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  icp_id uuid not null,
  audience_id uuid not null,
  member_id uuid not null,
  signal_id uuid,
  score numeric(8, 4) not null check (score >= 0 and score <= 1),
  confidence numeric(8, 4) not null default 0 check (confidence >= 0 and confidence <= 1),
  signal_type text not null,
  explanation text not null,
  evidence jsonb not null default '[]'::jsonb,
  score_version text not null,
  scored_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id)
    references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id)
    references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id)
    references public.sales_os_audience_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, signal_id)
    references public.sales_os_signals (tenant_id, id) on delete set null,
  check (expires_at is null or expires_at >= scored_at)
);

create table if not exists public.sales_os_audience_activations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  icp_id uuid not null,
  audience_id uuid not null,
  definition_id uuid not null,
  destination_type text not null check (destination_type in ('csv', 'webhook', 'crm')),
  destination_name text not null,
  destination_config jsonb not null default '{}'::jsonb,
  member_filter jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'syncing', 'completed', 'failed', 'cancelled')),
  approval_id uuid,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id)
    references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id)
    references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, definition_id)
    references public.sales_os_audience_definitions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, approval_id)
    references public.sales_os_approvals (tenant_id, id) on delete set null
);

create table if not exists public.sales_os_activation_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  activation_id uuid not null,
  member_id uuid not null,
  destination_record_id text,
  payload_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'synced', 'failed', 'suppressed', 'removed')),
  suppression_state text not null default 'clear'
    check (suppression_state in ('clear', 'suppressed', 'unknown')),
  synced_at timestamptz,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, activation_id, member_id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, activation_id)
    references public.sales_os_audience_activations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id)
    references public.sales_os_audience_members (tenant_id, id) on delete cascade
);

create table if not exists public.sales_os_activation_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  activation_id uuid not null,
  run_type text not null check (run_type in ('full', 'incremental', 'retry')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  idempotency_key text not null,
  cursor text,
  total_count integer not null default 0 check (total_count >= 0),
  synced_count integer not null default 0 check (synced_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, activation_id, idempotency_key),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, activation_id)
    references public.sales_os_audience_activations (tenant_id, id) on delete cascade
);

create index if not exists sales_os_audience_definitions_scope_idx
  on public.sales_os_audience_definitions (tenant_id, product_id, icp_id, audience_id, version desc);
create index if not exists sales_os_audience_definitions_status_idx
  on public.sales_os_audience_definitions (tenant_id, product_id, status, updated_at desc);
create index if not exists sales_os_audience_members_scope_idx
  on public.sales_os_audience_members (tenant_id, product_id, definition_id, status, freshness_at desc);
create index if not exists sales_os_audience_members_account_idx
  on public.sales_os_audience_members (tenant_id, product_id, account_id)
  where account_id is not null;
create index if not exists sales_os_audience_members_contact_idx
  on public.sales_os_audience_members (tenant_id, product_id, contact_id)
  where contact_id is not null;
create unique index if not exists sales_os_audience_members_source_unique
  on public.sales_os_audience_members (tenant_id, definition_id, source_system, source_record_id)
  where source_record_id is not null;
create index if not exists sales_os_identity_candidates_member_idx
  on public.sales_os_identity_candidates (tenant_id, member_id, status, confidence desc);
create index if not exists sales_os_identity_merges_member_idx
  on public.sales_os_identity_merges (tenant_id, member_id, status, created_at desc);
create index if not exists sales_os_enrichment_records_member_idx
  on public.sales_os_enrichment_records (tenant_id, member_id, entity_type, observed_at desc);
create index if not exists sales_os_enrichment_records_freshness_idx
  on public.sales_os_enrichment_records (tenant_id, product_id, freshness_at desc, status);
create index if not exists sales_os_quality_snapshots_member_idx
  on public.sales_os_audience_quality_snapshots (tenant_id, member_id, calculated_at desc);
create unique index if not exists sales_os_quality_snapshots_current_unique
  on public.sales_os_audience_quality_snapshots (tenant_id, member_id)
  where is_current;
create index if not exists sales_os_intent_scores_member_idx
  on public.sales_os_intent_scores (tenant_id, member_id, scored_at desc);
create index if not exists sales_os_intent_scores_scope_idx
  on public.sales_os_intent_scores (tenant_id, product_id, icp_id, audience_id, score desc);
create index if not exists sales_os_activations_scope_idx
  on public.sales_os_audience_activations (tenant_id, product_id, status, created_at desc);
create index if not exists sales_os_activation_records_status_idx
  on public.sales_os_activation_records (tenant_id, activation_id, status);
create index if not exists sales_os_sync_runs_activation_idx
  on public.sales_os_activation_sync_runs (tenant_id, activation_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_os_audience_definitions',
    'sales_os_audience_members',
    'sales_os_identity_candidates',
    'sales_os_identity_merges',
    'sales_os_enrichment_records',
    'sales_os_audience_quality_snapshots',
    'sales_os_intent_scores',
    'sales_os_audience_activations',
    'sales_os_activation_records',
    'sales_os_activation_sync_runs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists sales_os_audience_intelligence_select on public.%I', table_name);
    execute format('create policy sales_os_audience_intelligence_select on public.%I for select to authenticated using (tenant_id = ''sales_os'' and auth.role() = ''authenticated'')', table_name);
    execute format('drop policy if exists sales_os_audience_intelligence_insert on public.%I', table_name);
    execute format('create policy sales_os_audience_intelligence_insert on public.%I for insert to authenticated with check (tenant_id = ''sales_os'' and auth.role() = ''authenticated'')', table_name);
    execute format('drop policy if exists sales_os_audience_intelligence_update on public.%I', table_name);
    execute format('create policy sales_os_audience_intelligence_update on public.%I for update to authenticated using (tenant_id = ''sales_os'' and auth.role() = ''authenticated'') with check (tenant_id = ''sales_os'' and auth.role() = ''authenticated'')', table_name);
    execute format('drop trigger if exists sales_os_audience_intelligence_updated_at on public.%I', table_name);
    execute format('create trigger sales_os_audience_intelligence_updated_at before update on public.%I for each row execute function public.sales_os_set_updated_at()', table_name);
  end loop;
end $$;

comment on table public.sales_os_audience_definitions is
  'Versioned strategic audience definitions scoped to an approved product ICP and audience.';
comment on table public.sales_os_audience_members is
  'Operational audience members linked to an account, contact, or non-person external entity.';
comment on table public.sales_os_identity_candidates is
  'Candidate identity matches that require deterministic or human-reviewed resolution.';
comment on table public.sales_os_identity_merges is
  'Audited, reversible identity merge decisions; low-confidence merges require approval.';
comment on table public.sales_os_enrichment_records is
  'Provider-neutral company/contact enrichment observations with freshness and provenance.';
comment on table public.sales_os_audience_quality_snapshots is
  'Historical audience-member quality and readiness calculations separate from strategic fit.';
comment on table public.sales_os_intent_scores is
  'Product-aware, versioned intent scores for audience members and observed signals.';
comment on table public.sales_os_audience_activations is
  'Human-approved destination activation configuration for a versioned audience definition.';
comment on table public.sales_os_activation_records is
  'Per-member destination sync state for an audience activation.';
comment on table public.sales_os_activation_sync_runs is
  'Idempotent full, incremental, and retryable activation synchronization runs.';
