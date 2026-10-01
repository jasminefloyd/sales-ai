-- Sales OS ICP strategy and workflow orchestration.
-- Apply manually to the linked Supabase project.

alter table public.sales_os_product_profiles
  add column if not exists outreach_motion text,
  add column if not exists outreach_motion_reason text,
  add column if not exists collateral_strategy jsonb not null default '{}'::jsonb;

alter table public.sales_os_product_profiles
  drop constraint if exists sales_os_product_profiles_outreach_motion_check;

alter table public.sales_os_product_profiles
  add constraint sales_os_product_profiles_outreach_motion_check
  check (outreach_motion is null or outreach_motion in ('b2b', 'b2c', 'b2b2c', 'community'));

alter table public.sales_os_audiences
  add column if not exists outreach_motion text,
  add column if not exists outreach_motion_reason text,
  add column if not exists collateral_strategy jsonb not null default '{}'::jsonb;

alter table public.sales_os_audiences
  drop constraint if exists sales_os_audiences_outreach_motion_check;

alter table public.sales_os_audiences
  add constraint sales_os_audiences_outreach_motion_check
  check (outreach_motion is null or outreach_motion in ('b2b', 'b2c', 'b2b2c', 'community'));

alter table public.sales_os_audience_routes
  add column if not exists collateral_type text,
  add column if not exists auto_discover boolean not null default true;

create index if not exists sales_os_audiences_product_motion_idx
  on public.sales_os_audiences (tenant_id, product_id, outreach_motion, status);

create index if not exists sales_os_routes_discovery_idx
  on public.sales_os_audience_routes (tenant_id, product_id, status, auto_discover);

comment on column public.sales_os_audiences.outreach_motion is
  'ICP-derived acquisition motion; this drives route and collateral selection.';

comment on column public.sales_os_audiences.collateral_strategy is
  'Structured channel, CTA, tone, and collateral requirements derived from the ICP.';

comment on column public.sales_os_audience_routes.auto_discover is
  'When true, approving the ICP makes this route eligible for an automatic Find job.';
