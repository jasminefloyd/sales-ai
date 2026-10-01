create table if not exists public.sales_os_workflow_lineage (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  source_id uuid,
  profile_id uuid,
  icp_id uuid,
  audience_id uuid,
  outreach_decision_id uuid,
  engagement_id uuid,
  relation_type text not null check (relation_type in (
    'source_to_profile',
    'profile_to_icp',
    'icp_to_audience',
    'audience_to_outreach_decision',
    'outreach_decision_to_copy'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, product_id, relation_type, source_id, profile_id, icp_id, audience_id, outreach_decision_id, engagement_id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_id) references public.sales_os_product_sources (tenant_id, id) on delete cascade,
  foreign key (tenant_id, profile_id) references public.sales_os_product_profiles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, icp_id) references public.sales_os_icps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, audience_id) references public.sales_os_audiences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, outreach_decision_id) references public.sales_os_outreach_decisions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, engagement_id) references public.sales_os_engagements (tenant_id, id) on delete cascade
);

create index if not exists sales_os_workflow_lineage_product_idx
  on public.sales_os_workflow_lineage (tenant_id, product_id, created_at desc);

alter table public.sales_os_workflow_lineage enable row level security;

drop policy if exists sales_os_workflow_lineage_select on public.sales_os_workflow_lineage;
create policy sales_os_workflow_lineage_select on public.sales_os_workflow_lineage
  for select using (tenant_id = 'sales_os' and auth.uid() is not null);

drop policy if exists sales_os_workflow_lineage_insert on public.sales_os_workflow_lineage;
create policy sales_os_workflow_lineage_insert on public.sales_os_workflow_lineage
  for insert with check (tenant_id = 'sales_os' and auth.uid() is not null);

create or replace function public.sales_os_workflow_lineage_immutable()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE'
     and current_setting('sales_os.product_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Sales OS workflow lineage is append-only';
end;
$$;

drop trigger if exists sales_os_workflow_lineage_immutable_update on public.sales_os_workflow_lineage;
create trigger sales_os_workflow_lineage_immutable_update
  before update or delete on public.sales_os_workflow_lineage
  for each row execute function public.sales_os_workflow_lineage_immutable();
