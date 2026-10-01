create table if not exists public.sales_os_outreach_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  product_profile_id uuid,
  icp_id uuid not null,
  icp_version integer not null,
  audience_id uuid not null,
  audience_version integer not null,
  channel text not null check (channel in ('email', 'reddit', 'community', 'professional_social')),
  outreach_motion text not null check (outreach_motion in ('b2b', 'b2c', 'b2b2c', 'community')),
  objective text not null,
  rationale text not null,
  collateral_type text not null,
  cta text,
  strategy jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'paused')),
  version integer not null default 1 check (version > 0),
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  state_changed_at timestamptz not null default now(),
  state_changed_by text,
  unique (tenant_id, id),
  unique (tenant_id, audience_id, channel, version),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_profile_id) references public.sales_os_product_profiles (tenant_id, id) on delete set null,
  foreign key (tenant_id, icp_id) references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade
);

create index if not exists sales_os_outreach_decisions_product_status_idx
  on public.sales_os_outreach_decisions (tenant_id, product_id, status);

alter table public.sales_os_outreach_decisions enable row level security;

drop policy if exists sales_os_outreach_decisions_select on public.sales_os_outreach_decisions;
create policy sales_os_outreach_decisions_select on public.sales_os_outreach_decisions
  for select using (tenant_id = 'sales_os' and auth.uid() is not null);

drop policy if exists sales_os_outreach_decisions_insert on public.sales_os_outreach_decisions;
create policy sales_os_outreach_decisions_insert on public.sales_os_outreach_decisions
  for insert with check (tenant_id = 'sales_os' and auth.uid() is not null);

drop policy if exists sales_os_outreach_decisions_update on public.sales_os_outreach_decisions;
create policy sales_os_outreach_decisions_update on public.sales_os_outreach_decisions
  for update using (tenant_id = 'sales_os' and auth.uid() is not null)
  with check (tenant_id = 'sales_os' and auth.uid() is not null);

drop trigger if exists sales_os_outreach_decisions_updated_at on public.sales_os_outreach_decisions;
create trigger sales_os_outreach_decisions_updated_at
  before update on public.sales_os_outreach_decisions
  for each row execute function public.sales_os_set_updated_at();
