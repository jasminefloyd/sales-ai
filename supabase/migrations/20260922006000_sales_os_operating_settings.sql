create table public.sales_os_operating_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  setting_key text not null check (setting_key in (
    'attribution_window_days', 'evidence_score_minimum',
    'sending_limit_daily', 'follow_up_limit'
  )),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, product_id, setting_key),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

create trigger sales_os_operating_settings_updated_at
  before update on public.sales_os_operating_settings
  for each row execute function public.sales_os_set_updated_at();

alter table public.sales_os_operating_settings enable row level security;
create policy sales_os_operating_settings_tenant_isolation
  on public.sales_os_operating_settings
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');
create policy sales_os_operating_settings_authenticated_insert
  on public.sales_os_operating_settings
  for insert to authenticated
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');
