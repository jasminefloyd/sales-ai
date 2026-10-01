create table public.sales_os_conversion_attribution_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  conversion_id uuid not null,
  previous_last_touch_engagement_id uuid,
  next_last_touch_engagement_id uuid,
  previous_last_touch_dimensions jsonb not null default '{}'::jsonb,
  next_last_touch_dimensions jsonb not null default '{}'::jsonb,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, conversion_id)
    references public.sales_os_conversions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, previous_last_touch_engagement_id)
    references public.sales_os_engagements (tenant_id, id) on delete set null,
  foreign key (tenant_id, next_last_touch_engagement_id)
    references public.sales_os_engagements (tenant_id, id) on delete set null
);

create index sales_os_conversion_attribution_history_conversion_idx
  on public.sales_os_conversion_attribution_history (tenant_id, conversion_id, created_at desc);

alter table public.sales_os_conversion_attribution_history enable row level security;
create policy sales_os_conversion_attribution_history_tenant_isolation
  on public.sales_os_conversion_attribution_history
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');
create policy sales_os_conversion_attribution_history_authenticated_insert
  on public.sales_os_conversion_attribution_history
  for insert to authenticated
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');
