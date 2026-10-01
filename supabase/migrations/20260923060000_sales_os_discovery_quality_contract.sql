-- Discovery quality contract: commercial validation and route-independent
-- opportunity qualification fields.

alter table public.sales_os_icps
  add column if not exists budget_fit text not null default 'unknown',
  add column if not exists purchase_readiness text not null default 'unknown',
  add column if not exists commercial_evidence jsonb not null default '[]'::jsonb,
  add column if not exists validation_status text not null default 'pending_review'
    check (validation_status in ('pending_review', 'validated', 'rejected')),
  add column if not exists validation_rationale text not null default 'Human review required.';

alter table public.sales_os_audiences
  add column if not exists validation_status text not null default 'pending_review'
    check (validation_status in ('pending_review', 'validated', 'rejected')),
  add column if not exists validation_evidence jsonb not null default '[]'::jsonb,
  add column if not exists commercial_intent_score numeric(8, 4)
    check (commercial_intent_score >= 0 and commercial_intent_score <= 1);

alter table public.sales_os_opportunities
  add column if not exists signal_type text,
  add column if not exists fit_score numeric(8, 4)
    check (fit_score >= 0 and fit_score <= 1),
  add column if not exists qualification_reason text,
  add column if not exists suppression_checked boolean not null default false;

create index if not exists sales_os_icps_validation_idx
  on public.sales_os_icps (tenant_id, product_id, validation_status);
create index if not exists sales_os_audiences_validation_idx
  on public.sales_os_audiences (tenant_id, product_id, validation_status);
