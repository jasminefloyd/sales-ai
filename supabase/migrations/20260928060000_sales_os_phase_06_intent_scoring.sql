-- Sales OS Audience Intelligence Phase 6: product-specific intent scoring.

alter table public.sales_os_jobs
  drop constraint if exists sales_os_jobs_job_type_check;

alter table public.sales_os_jobs
  add constraint sales_os_jobs_job_type_check
  check (job_type in (
    'product_analysis',
    'audience_discovery',
    'audience_enrichment',
    'audience_quality',
    'audience_intent',
    'find',
    'engagement_batch',
    'learning_analysis',
    'attribution',
    'console_action'
  ));

create table if not exists public.sales_os_signal_taxonomy (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  signal_type text not null,
  display_name text not null,
  aliases jsonb not null default '[]'::jsonb,
  direction text not null default 'positive' check (direction in ('positive', 'negative', 'neutral')),
  default_weight numeric(8, 4) not null default 0.5 check (default_weight >= 0 and default_weight <= 1),
  recency_window_days integer not null default 30 check (recency_window_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, signal_type)
);

insert into public.sales_os_signal_taxonomy
  (tenant_id, signal_type, display_name, aliases, direction, default_weight, recency_window_days, created_by)
values
  ('sales_os', 'request_for_solution', 'Request for solution', '["looking for", "recommendation", "how do I"]'::jsonb, 'positive', 0.9, 30, 'system'),
  ('sales_os', 'pain_complaint', 'Pain or complaint', '["frustrated", "broken", "struggle"]'::jsonb, 'positive', 0.8, 30, 'system'),
  ('sales_os', 'pricing_signal', 'Pricing or budget signal', '["price", "cost", "expensive"]'::jsonb, 'neutral', 0.6, 21, 'system'),
  ('sales_os', 'competitor_reference', 'Competitor or alternative reference', '["alternative", "competitor", "switch"]'::jsonb, 'positive', 0.75, 45, 'system'),
  ('sales_os', 'negative_fit', 'Negative fit signal', '["not interested", "do not need", "already solved"]'::jsonb, 'negative', 0.9, 30, 'system'),
  ('sales_os', 'direct_contact_fit', 'Direct contact fit', '[]'::jsonb, 'positive', 0.85, 60, 'system'),
  ('sales_os', 'relevant_discussion', 'Relevant discussion', '[]'::jsonb, 'neutral', 0.55, 30, 'system')
on conflict (tenant_id, signal_type) do nothing;

alter table public.sales_os_signals
  add column if not exists normalized_signal_type text,
  add column if not exists signal_direction text not null default 'positive'
    check (signal_direction in ('positive', 'negative', 'neutral')),
  add column if not exists base_weight numeric(8, 4) not null default 0.5
    check (base_weight >= 0 and base_weight <= 1),
  add column if not exists recency_window_days integer not null default 30
    check (recency_window_days > 0),
  add column if not exists frequency_boost numeric(8, 4) not null default 0
    check (frequency_boost >= 0 and frequency_boost <= 1);

alter table public.sales_os_intent_scores
  add column if not exists raw_score numeric(8, 4)
    check (raw_score is null or (raw_score >= 0 and raw_score <= 1)),
  add column if not exists score_explanation jsonb not null default '{}'::jsonb,
  add column if not exists calculation_version text not null default 'intent_v1',
  add column if not exists source_observation_count integer not null default 1
    check (source_observation_count >= 0),
  add column if not exists override_score numeric(8, 4)
    check (override_score is null or (override_score >= 0 and override_score <= 1)),
  add column if not exists override_reason text,
  add column if not exists overridden_by text,
  add column if not exists overridden_at timestamptz,
  add column if not exists updated_by text;

create index if not exists sales_os_signals_intent_type_idx
  on public.sales_os_signals (tenant_id, product_id, audience_id, normalized_signal_type, status);
create index if not exists sales_os_intent_scores_current_idx
  on public.sales_os_intent_scores (tenant_id, product_id, audience_id, member_id, scored_at desc);
create index if not exists sales_os_signal_taxonomy_type_idx
  on public.sales_os_signal_taxonomy (tenant_id, signal_type);

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
    when 'audience_intent' then 'find'
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

comment on table public.sales_os_signal_taxonomy is
  'Normalized, product-independent signal vocabulary used by product-specific intent scoring.';
comment on column public.sales_os_intent_scores.score_explanation is
  'Deterministic components, recency decay, frequency boost, fit terms, penalties, and evidence.';
