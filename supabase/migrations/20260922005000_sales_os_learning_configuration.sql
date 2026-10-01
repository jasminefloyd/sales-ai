create table public.sales_os_learning_configurations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  target_key text not null check (target_key in (
    'route_priority', 'source_priority', 'contact_role_preference',
    'message_angle_preference', 'cta_preference', 'follow_up_cadence',
    'evidence_score_rubric'
  )),
  target_entity_id uuid,
  value jsonb not null default '{}'::jsonb,
  source_learning_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, product_id, target_key, target_entity_id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_learning_id) references public.sales_os_learnings (tenant_id, id) on delete set null
);

create index sales_os_learning_configurations_product_idx
  on public.sales_os_learning_configurations (tenant_id, product_id, target_key);

create trigger sales_os_learning_configurations_updated_at
  before update on public.sales_os_learning_configurations
  for each row execute function public.sales_os_set_updated_at();

alter table public.sales_os_learning_configurations enable row level security;
create policy sales_os_learning_configurations_tenant_isolation
  on public.sales_os_learning_configurations
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');
create policy sales_os_learning_configurations_authenticated_insert
  on public.sales_os_learning_configurations
  for insert to authenticated
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');
