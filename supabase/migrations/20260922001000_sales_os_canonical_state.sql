-- Sales OS Phase 2: canonical state and deterministic database guardrails.
-- All objects in this migration are Sales OS-owned and use the required
-- sales_os_ namespace. Provider secrets are never stored in these tables.

create table public.sales_os_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  name text not null,
  slug text not null,
  website_url text,
  description_input text,
  primary_objective text,
  geographic_constraints jsonb,
  additional_context text,
  status text not null default 'draft' check (status in ('draft', 'analyzing', 'audience_review', 'active', 'paused')),
  monthly_spend_cap numeric(12, 4),
  per_run_spend_cap numeric(12, 4),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  unique (tenant_id, slug)
);

create table public.sales_os_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  capability text not null,
  provider_key text not null,
  display_name text not null,
  enabled boolean not null default false,
  priority integer not null default 100 check (priority >= 0),
  configuration jsonb not null default '{}'::jsonb,
  pricing_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, capability, provider_key)
);

create table public.sales_os_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  job_type text not null check (job_type in ('product_analysis', 'audience_discovery', 'find', 'engagement_batch', 'learning_analysis', 'attribution', 'console_action')),
  status text not null default 'queued' check (status in ('queued', 'running', 'paused_budget', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  estimated_cost numeric(12, 4),
  actual_cost numeric(12, 4) not null default 0,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete restrict
);

create table public.sales_os_product_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  version integer not null check (version > 0),
  category text not null,
  description text not null,
  problems_solved jsonb not null default '[]'::jsonb,
  core_capabilities jsonb not null default '[]'::jsonb,
  primary_use_cases jsonb not null default '[]'::jsonb,
  pricing_business_model jsonb not null default '{}'::jsonb,
  conversion_event jsonb not null default '{}'::jsonb,
  purchase_friction text not null,
  competitive_alternatives jsonb not null default '[]'::jsonb,
  purchase_triggers jsonb not null default '[]'::jsonb,
  positioning_value_props jsonb not null default '[]'::jsonb,
  source_evidence jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, version),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

create table public.sales_os_audiences (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  name text not null,
  buyer_type text not null check (buyer_type in ('individual', 'organization')),
  problem_use_case_fit text not null,
  buying_behavior jsonb not null default '{}'::jsonb,
  purchase_triggers jsonb not null default '[]'::jsonb,
  relevant_terminology jsonb not null default '[]'::jsonb,
  supporting_evidence jsonb not null default '[]'::jsonb,
  evidence_score text not null default 'low' check (evidence_score in ('low', 'medium', 'high')),
  evidence_score_detail jsonb not null default '{}'::jsonb,
  ai_fit_assessment text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'active', 'paused', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

create table public.sales_os_audience_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  audience_id uuid not null,
  route_type text not null check (route_type in ('social', 'direct')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'active', 'paused', 'rejected')),
  rationale text not null,
  search_strategy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  unique (tenant_id, audience_id, route_type),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade
);

create table public.sales_os_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  provider_id uuid,
  source_type text not null check (source_type in ('web', 'reddit', 'forum', 'blog', 'professional', 'company_site', 'other')),
  name text not null,
  url text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, provider_id) references public.sales_os_providers (tenant_id, id) on delete set null
);

create table public.sales_os_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  audience_id uuid not null,
  name text not null,
  description text not null,
  signal_type text not null,
  specificity numeric(8, 4) not null default 0 check (specificity >= 0 and specificity <= 1),
  status text not null default 'active' check (status in ('active', 'paused')),
  weight numeric(8, 4) not null default 1 check (weight >= 0),
  origin text not null check (origin in ('initial_analysis', 'learning', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade
);

create table public.sales_os_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  name text not null,
  domain text not null,
  normalized_domain text generated always as (lower(trim(domain))) stored,
  website_url text not null,
  industry text,
  company_context jsonb not null default '{}'::jsonb,
  source_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, normalized_domain),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

create table public.sales_os_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  account_id uuid,
  full_name text not null,
  title text,
  professional_profile_url text,
  professional_email text,
  normalized_email text generated always as (nullif(lower(trim(professional_email)), '')) stored,
  email_verification_status text not null default 'unknown' check (email_verification_status in ('unknown', 'valid', 'risky', 'invalid')),
  email_verification_provider text,
  source_evidence jsonb not null default '[]'::jsonb,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references public.sales_os_accounts (tenant_id, id) on delete set null
);

create unique index sales_os_contacts_product_email_unique
  on public.sales_os_contacts (tenant_id, product_id, normalized_email)
  where normalized_email is not null;

create table public.sales_os_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  audience_id uuid not null,
  route_type text not null check (route_type in ('social', 'direct')),
  source_id uuid not null,
  signal_id uuid,
  account_id uuid,
  contact_id uuid,
  title text not null,
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  evidence_score text not null default 'low' check (evidence_score in ('low', 'medium', 'high')),
  evidence_score_detail jsonb not null default '{}'::jsonb,
  ai_fit_assessment text not null,
  recommended_action text not null,
  status text not null default 'discovered' check (status in ('discovered', 'qualified', 'awaiting_review', 'approved', 'rejected', 'engagement_pending', 'engaged', 'responded', 'converted', 'closed')),
  discovered_at timestamptz not null default now(),
  dedupe_key text not null,
  first_touch_dimensions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, dedupe_key),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references public.sales_os_sources (tenant_id, id) on delete restrict,
  foreign key (tenant_id, signal_id) references public.sales_os_signals (tenant_id, id) on delete set null,
  foreign key (tenant_id, account_id) references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, contact_id) references public.sales_os_contacts (tenant_id, id) on delete set null
);

create table public.sales_os_engagements (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  opportunity_id uuid not null,
  contact_id uuid,
  channel text not null check (channel in ('email', 'reddit', 'community', 'professional_social', 'manual')),
  action_type text not null check (action_type in ('draft', 'send', 'follow_up', 'respond', 'monitor', 'ignore', 'escalate')),
  message_angle text,
  cta text,
  draft_content text not null,
  final_content text,
  status text not null default 'drafted' check (status in ('drafted', 'awaiting_approval', 'approved', 'rejected', 'queued', 'executed', 'failed', 'cancelled')),
  provider_id uuid,
  external_message_id text,
  scheduled_for timestamptz,
  executed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, opportunity_id) references public.sales_os_opportunities (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.sales_os_contacts (tenant_id, id) on delete set null,
  foreign key (tenant_id, provider_id) references public.sales_os_providers (tenant_id, id) on delete set null
);

create table public.sales_os_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  opportunity_id uuid not null,
  contact_id uuid,
  channel text not null check (channel in ('email', 'reddit', 'community', 'professional_social', 'manual')),
  external_thread_id text,
  status text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, opportunity_id) references public.sales_os_opportunities (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.sales_os_contacts (tenant_id, id) on delete set null
);

create table public.sales_os_suppression_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  contact_id uuid,
  channel text not null check (channel in ('email', 'reddit', 'community', 'professional_social', 'manual')),
  identifier text not null,
  reason text not null check (reason in ('unsubscribe', 'manual', 'bounced', 'invalid', 'do_not_contact', 'platform_rule', 'other')),
  source text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.sales_os_contacts (tenant_id, id) on delete set null
);

create unique index sales_os_suppression_active_unique
  on public.sales_os_suppression_records (tenant_id, product_id, channel, lower(trim(identifier)))
  where active;

create table public.sales_os_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  action_type text not null,
  proposed_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'executed')),
  requested_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

create table public.sales_os_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  opportunity_id uuid,
  audience_id uuid,
  account_id uuid,
  contact_id uuid,
  engagement_id uuid,
  source_id uuid,
  signal_id uuid,
  provider_id uuid,
  dimensions jsonb not null default '{}'::jsonb,
  external_event_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, idempotency_key),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, opportunity_id) references public.sales_os_opportunities (tenant_id, id) on delete set null,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete set null,
  foreign key (tenant_id, account_id) references public.sales_os_accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, contact_id) references public.sales_os_contacts (tenant_id, id) on delete set null,
  foreign key (tenant_id, engagement_id) references public.sales_os_engagements (tenant_id, id) on delete set null,
  foreign key (tenant_id, source_id) references public.sales_os_sources (tenant_id, id) on delete set null,
  foreign key (tenant_id, signal_id) references public.sales_os_signals (tenant_id, id) on delete set null,
  foreign key (tenant_id, provider_id) references public.sales_os_providers (tenant_id, id) on delete set null
);

create table public.sales_os_conversions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  event_id uuid not null,
  conversion_type text not null check (conversion_type in ('signup', 'trial', 'purchase', 'subscription', 'other')),
  value numeric(12, 4),
  currency text not null default 'USD',
  customer_external_id text,
  converted_at timestamptz not null default now(),
  first_touch_opportunity_id uuid,
  first_touch_dimensions jsonb not null default '{}'::jsonb,
  last_touch_engagement_id uuid,
  last_touch_dimensions jsonb not null default '{}'::jsonb,
  attribution_window_days integer not null default 30 check (attribution_window_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, event_id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, event_id) references public.sales_os_events (tenant_id, id) on delete restrict,
  foreign key (tenant_id, first_touch_opportunity_id) references public.sales_os_opportunities (tenant_id, id) on delete set null,
  foreign key (tenant_id, last_touch_engagement_id) references public.sales_os_engagements (tenant_id, id) on delete set null
);

create table public.sales_os_learnings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  observation text not null,
  supporting_evidence jsonb not null default '{}'::jsonb,
  sample_size integer not null check (sample_size >= 0),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  recommended_change jsonb not null default '{}'::jsonb,
  target_phase text not null check (target_phase in ('product_audience', 'route_find', 'engage', 'provider_layer')),
  target_entity_type text,
  target_entity_id uuid,
  status text not null default 'detected' check (status in ('detected', 'proposed', 'approved', 'rejected', 'active', 'superseded')),
  applied_at timestamptz,
  supersedes_learning_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_learning_id) references public.sales_os_learnings (tenant_id, id) on delete set null
);

create table public.sales_os_provider_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  provider_id uuid not null,
  capability text not null,
  job_id uuid,
  request_reference text,
  status text not null check (status in ('started', 'succeeded', 'failed', 'skipped_budget')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  latency_ms integer,
  units numeric(12, 4),
  estimated_cost numeric(12, 4) not null default 0,
  actual_cost numeric(12, 4),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, provider_id) references public.sales_os_providers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, job_id) references public.sales_os_jobs (tenant_id, id) on delete set null
);

-- Product-scoped access paths and deterministic dedupe indexes.
create index sales_os_profiles_product_idx on public.sales_os_product_profiles (tenant_id, product_id, version desc);
create index sales_os_audiences_product_status_idx on public.sales_os_audiences (tenant_id, product_id, status);
create index sales_os_routes_product_status_idx on public.sales_os_audience_routes (tenant_id, product_id, status);
create index sales_os_sources_product_idx on public.sales_os_sources (tenant_id, product_id);
create index sales_os_signals_product_audience_idx on public.sales_os_signals (tenant_id, product_id, audience_id);
create index sales_os_accounts_product_idx on public.sales_os_accounts (tenant_id, product_id);
create index sales_os_contacts_product_account_idx on public.sales_os_contacts (tenant_id, product_id, account_id);
create index sales_os_opportunities_product_status_idx on public.sales_os_opportunities (tenant_id, product_id, status, discovered_at desc);
create index sales_os_engagements_product_status_idx on public.sales_os_engagements (tenant_id, product_id, status);
create index sales_os_conversations_product_idx on public.sales_os_conversations (tenant_id, product_id, last_activity_at desc);
create index sales_os_suppressions_product_lookup_idx on public.sales_os_suppression_records (tenant_id, product_id, channel, lower(trim(identifier))) where active;
create index sales_os_approvals_product_status_idx on public.sales_os_approvals (tenant_id, product_id, status);
create index sales_os_events_product_occurred_idx on public.sales_os_events (tenant_id, product_id, occurred_at desc);
create index sales_os_conversions_product_converted_idx on public.sales_os_conversions (tenant_id, product_id, converted_at desc);
create index sales_os_learnings_product_status_idx on public.sales_os_learnings (tenant_id, product_id, status);
create index sales_os_provider_runs_product_started_idx on public.sales_os_provider_runs (tenant_id, product_id, started_at desc);
create index sales_os_jobs_product_status_idx on public.sales_os_jobs (tenant_id, product_id, status, created_at desc);

create or replace function public.sales_os_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sales_os_validate_transition(
  p_entity_type text,
  p_old_status text,
  p_new_status text
)
returns void
language plpgsql
immutable
as $$
begin
  if p_old_status = p_new_status then
    return;
  end if;

  if not (
    (p_entity_type = 'product' and ((p_old_status = 'draft' and p_new_status in ('analyzing', 'paused')) or (p_old_status = 'analyzing' and p_new_status in ('audience_review', 'paused')) or (p_old_status = 'audience_review' and p_new_status in ('active', 'paused')) or (p_old_status = 'active' and p_new_status = 'paused') or (p_old_status = 'paused' and p_new_status = 'active'))) or
    (p_entity_type = 'audience' and ((p_old_status = 'proposed' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('active', 'paused', 'rejected')) or (p_old_status = 'active' and p_new_status = 'paused') or (p_old_status = 'paused' and p_new_status in ('active', 'rejected')))) or
    (p_entity_type = 'opportunity' and ((p_old_status = 'discovered' and p_new_status in ('qualified', 'rejected', 'closed')) or (p_old_status = 'qualified' and p_new_status in ('awaiting_review', 'rejected', 'closed')) or (p_old_status = 'awaiting_review' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('engagement_pending', 'rejected', 'closed')) or (p_old_status = 'engagement_pending' and p_new_status in ('engaged', 'rejected', 'closed')) or (p_old_status = 'engaged' and p_new_status in ('responded', 'converted', 'closed')) or (p_old_status = 'responded' and p_new_status in ('converted', 'closed')))) or
    (p_entity_type = 'engagement' and ((p_old_status = 'drafted' and p_new_status in ('awaiting_approval', 'rejected', 'cancelled')) or (p_old_status = 'awaiting_approval' and p_new_status in ('approved', 'rejected', 'cancelled')) or (p_old_status = 'approved' and p_new_status in ('queued', 'cancelled')) or (p_old_status = 'queued' and p_new_status in ('executed', 'failed', 'cancelled')) or (p_old_status = 'failed' and p_new_status in ('queued', 'cancelled')))) or
    (p_entity_type = 'learning' and ((p_old_status = 'detected' and p_new_status in ('proposed', 'rejected')) or (p_old_status = 'proposed' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('active', 'rejected')) or (p_old_status = 'active' and p_new_status = 'superseded'))) or
    (p_entity_type = 'approval' and ((p_old_status = 'pending' and p_new_status in ('approved', 'rejected', 'expired')) or (p_old_status = 'approved' and p_new_status = 'executed'))) or
    (p_entity_type = 'job' and ((p_old_status = 'queued' and p_new_status in ('running', 'cancelled')) or (p_old_status = 'running' and p_new_status in ('paused_budget', 'waiting_approval', 'completed', 'failed', 'cancelled')) or (p_old_status = 'paused_budget' and p_new_status in ('queued', 'cancelled')) or (p_old_status = 'waiting_approval' and p_new_status in ('queued', 'cancelled'))))
  ) then
    raise exception 'Invalid % transition: % -> %', p_entity_type, p_old_status, p_new_status;
  end if;
end;
$$;

create or replace function public.sales_os_validate_state_transition()
returns trigger
language plpgsql
as $$
begin
  perform public.sales_os_validate_transition(TG_ARGV[0], old.status, new.status);
  new.state_changed_at = case when old.status = new.status then old.state_changed_at else now() end;
  new.state_changed_by = case when old.status = new.status then old.state_changed_by else coalesce(new.updated_by, new.state_changed_by) end;
  return new;
end;
$$;

create or replace function public.sales_os_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Sales OS events are append-only';
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_os_products', 'sales_os_providers', 'sales_os_jobs',
    'sales_os_product_profiles', 'sales_os_audiences', 'sales_os_audience_routes',
    'sales_os_sources', 'sales_os_signals', 'sales_os_accounts', 'sales_os_contacts',
    'sales_os_opportunities', 'sales_os_engagements', 'sales_os_conversations',
    'sales_os_suppression_records', 'sales_os_approvals', 'sales_os_conversions',
    'sales_os_learnings', 'sales_os_provider_runs'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.sales_os_set_updated_at()', table_name || '_updated_at', table_name);
  end loop;
end;
$$;

create trigger sales_os_events_immutable_update
  before update or delete on public.sales_os_events
  for each row execute function public.sales_os_events_immutable();

create trigger sales_os_products_state_transition
  before update of status on public.sales_os_products
  for each row execute function public.sales_os_validate_state_transition('product');
create trigger sales_os_audiences_state_transition
  before update of status on public.sales_os_audiences
  for each row execute function public.sales_os_validate_state_transition('audience');
create trigger sales_os_opportunities_state_transition
  before update of status on public.sales_os_opportunities
  for each row execute function public.sales_os_validate_state_transition('opportunity');
create trigger sales_os_engagements_state_transition
  before update of status on public.sales_os_engagements
  for each row execute function public.sales_os_validate_state_transition('engagement');
create trigger sales_os_learnings_state_transition
  before update of status on public.sales_os_learnings
  for each row execute function public.sales_os_validate_state_transition('learning');
create trigger sales_os_approvals_state_transition
  before update of status on public.sales_os_approvals
  for each row execute function public.sales_os_validate_state_transition('approval');
create trigger sales_os_jobs_state_transition
  before update of status on public.sales_os_jobs
  for each row execute function public.sales_os_validate_state_transition('job');

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_os_products', 'sales_os_providers', 'sales_os_jobs',
    'sales_os_product_profiles', 'sales_os_audiences', 'sales_os_audience_routes',
    'sales_os_sources', 'sales_os_signals', 'sales_os_accounts', 'sales_os_contacts',
    'sales_os_opportunities', 'sales_os_engagements', 'sales_os_conversations',
    'sales_os_suppression_records', 'sales_os_approvals', 'sales_os_events',
    'sales_os_conversions', 'sales_os_learnings', 'sales_os_provider_runs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = ''sales_os'' and auth.role() = ''authenticated'')', table_name || '_tenant_isolation', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (tenant_id = ''sales_os'' and auth.role() = ''authenticated'')', table_name || '_authenticated_insert', table_name);
  end loop;
end;
$$;

comment on table public.sales_os_events is 'Append-only Sales OS event ledger with immutable decision-dimension snapshots.';
comment on table public.sales_os_suppression_records is 'Product-scoped suppression state; never inherited across products.';
