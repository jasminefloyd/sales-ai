-- Repair for 20260923050000_sales_os_phase_contracts.sql.
-- The original legacy backfill used a fixed version=1 and could fail when a
-- product had multiple legacy audiences. This migration is safe to run after
-- a failed/partial attempt or against a database where the original migration
-- was fully rolled back.

create table if not exists public.sales_os_icps (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  version integer not null default 1 check (version > 0),
  name text not null,
  buyer_type text not null check (buyer_type in ('individual', 'organization')),
  summary text not null,
  core_problem text not null,
  why_product_fits text not null,
  purchase_trigger text not null,
  current_alternative text not null,
  buying_motivation text not null,
  purchase_friction text not null,
  decision_maker text,
  company_characteristics jsonb not null default '{}'::jsonb,
  user_characteristics jsonb not null default '{}'::jsonb,
  relevant_language jsonb not null default '[]'::jsonb,
  acquisition_routes jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  evidence_score text not null default 'low' check (evidence_score in ('low', 'medium', 'high')),
  evidence_score_detail jsonb not null default '{}'::jsonb,
  ai_fit_assessment text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'active', 'paused', 'rejected')),
  is_primary boolean not null default false,
  quality_gate jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  unique (tenant_id, product_id, version),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  check (is_primary = false or status <> 'rejected')
);

create unique index if not exists sales_os_icps_one_primary_per_product
  on public.sales_os_icps (tenant_id, product_id)
  where is_primary = true and status <> 'rejected';

alter table public.sales_os_audiences
  add column if not exists icp_id uuid,
  add column if not exists icp_version integer not null default 1 check (icp_version > 0),
  add column if not exists audience_version integer not null default 1 check (audience_version > 0),
  add column if not exists audience_summary text,
  add column if not exists reachability_evidence jsonb not null default '[]'::jsonb,
  add column if not exists quality_gate jsonb not null default '{}'::jsonb;

do $$
declare
  audience_row record;
  parent_id uuid;
  next_version integer;
  make_primary boolean;
begin
  for audience_row in
    select a.*
    from public.sales_os_audiences a
    where a.icp_id is null
    order by a.product_id, a.created_at, a.id
  loop
    select coalesce(max(existing.version), 0) + 1
      into next_version
    from public.sales_os_icps existing
    where existing.tenant_id = audience_row.tenant_id
      and existing.product_id = audience_row.product_id;

    select not exists (
      select 1
      from public.sales_os_icps existing
      where existing.tenant_id = audience_row.tenant_id
        and existing.product_id = audience_row.product_id
        and existing.is_primary = true
        and existing.status <> 'rejected'
    ) into make_primary;

    insert into public.sales_os_icps (
      tenant_id, product_id, version, name, buyer_type, summary, core_problem,
      why_product_fits, purchase_trigger, current_alternative, buying_motivation,
      purchase_friction, user_characteristics, relevant_language, evidence,
      evidence_score, evidence_score_detail, ai_fit_assessment, priority, status,
      is_primary, quality_gate, created_by, updated_by, state_changed_by
    ) values (
      audience_row.tenant_id,
      audience_row.product_id,
      next_version,
      audience_row.name,
      audience_row.buyer_type,
      audience_row.problem_use_case_fit,
      audience_row.problem_use_case_fit,
      coalesce(audience_row.ai_fit_assessment, 'Legacy audience profile requires review.'),
      coalesce(audience_row.purchase_triggers->>0, 'Unknown'),
      'Unknown',
      audience_row.problem_use_case_fit,
      'Unknown',
      audience_row.buying_behavior,
      audience_row.relevant_terminology,
      audience_row.supporting_evidence,
      audience_row.evidence_score,
      audience_row.evidence_score_detail,
      audience_row.ai_fit_assessment,
      audience_row.priority,
      audience_row.status,
      make_primary,
      jsonb_build_object('legacyBackfill', true, 'requiresReview', true),
      audience_row.created_by,
      audience_row.updated_by,
      audience_row.state_changed_by
    ) returning id into parent_id;

    update public.sales_os_audiences
      set icp_id = parent_id,
          icp_version = next_version,
          audience_version = 1,
          audience_summary = audience_row.problem_use_case_fit,
          reachability_evidence = audience_row.supporting_evidence,
          quality_gate = jsonb_build_object('legacyBackfill', true, 'requiresReview', true)
    where tenant_id = audience_row.tenant_id and id = audience_row.id;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_audiences_icp_fk'
      and conrelid = 'public.sales_os_audiences'::regclass
  ) then
    alter table public.sales_os_audiences
      add constraint sales_os_audiences_icp_fk
      foreign key (tenant_id, icp_id) references public.sales_os_icps (tenant_id, id) on delete cascade;
  end if;
end $$;

create index if not exists sales_os_audiences_icp_version_idx
  on public.sales_os_audiences (tenant_id, icp_id, audience_version desc);

create table if not exists public.sales_os_product_profile_provenance (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  profile_id uuid not null,
  field_name text not null,
  value jsonb not null,
  source text,
  source_type text not null check (source_type in ('user', 'website', 'provider', 'research', 'ai', 'unknown')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  evidence_status text not null check (evidence_status in ('known', 'researched', 'inferred', 'unknown')),
  created_at timestamptz not null default now(),
  unique (tenant_id, profile_id, field_name),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, profile_id) references public.sales_os_product_profiles (tenant_id, id) on delete cascade
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_products_intake_contract_check'
      and conrelid = 'public.sales_os_products'::regclass
  ) then
    alter table public.sales_os_products
      add constraint sales_os_products_intake_contract_check
      check (
        length(trim(name)) > 0
        and (nullif(trim(website_url), '') is not null or nullif(trim(description_input), '') is not null)
        and nullif(trim(primary_objective), '') is not null
      ) not valid;
  end if;
end $$;

alter table public.sales_os_engagements
  add column if not exists objective text,
  add column if not exists subject text,
  add column if not exists evidence_context jsonb not null default '[]'::jsonb,
  add column if not exists why_engage text,
  add column if not exists follow_up_strategy jsonb not null default '{}'::jsonb,
  add column if not exists risk_sensitivity text,
  add column if not exists previous_interaction jsonb not null default '{}'::jsonb,
  add column if not exists suppression_check jsonb not null default '{}'::jsonb;
