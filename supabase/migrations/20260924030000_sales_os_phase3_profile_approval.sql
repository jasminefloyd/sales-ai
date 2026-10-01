-- Phase 3: Product Sales Profile review and approval.

alter table public.sales_os_product_profiles
  add column if not exists review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'approved', 'rejected')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists review_notes text;

-- Profiles generated before the human approval workflow must be reviewed again.
update public.sales_os_product_profiles
set review_status = 'needs_review',
    is_active = false,
    approved_at = null,
    approved_by = null
where review_status is distinct from 'needs_review';

update public.sales_os_product_profiles
set is_active = false,
    approved_at = null,
    approved_by = null
where review_status = 'needs_review';

create index if not exists sales_os_product_profiles_review_idx
  on public.sales_os_product_profiles (tenant_id, product_id, review_status, version desc);

comment on column public.sales_os_product_profiles.review_status is
  'Human review state. Only an approved profile can drive downstream strategy generation.';
