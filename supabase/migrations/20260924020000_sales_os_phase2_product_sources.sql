-- Phase 2: persist product source material and parsing state.

create table if not exists public.sales_os_product_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  source_type text not null check (source_type in ('file', 'free_text', 'website')),
  file_name text,
  mime_type text,
  content text not null,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsing', 'parsed', 'failed')),
  parsed_fields jsonb not null default '{}'::jsonb,
  parse_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id)
    on delete cascade,
  check (
    (source_type = 'file' and file_name is not null) or
    source_type in ('free_text', 'website')
  )
);

create index if not exists sales_os_product_sources_product_idx
  on public.sales_os_product_sources (tenant_id, product_id, created_at desc);

alter table public.sales_os_product_sources enable row level security;

drop policy if exists sales_os_product_sources_tenant_isolation
  on public.sales_os_product_sources;
create policy sales_os_product_sources_tenant_isolation
  on public.sales_os_product_sources
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');

drop policy if exists sales_os_product_sources_authenticated_insert
  on public.sales_os_product_sources;
create policy sales_os_product_sources_authenticated_insert
  on public.sales_os_product_sources
  for insert to authenticated
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');

drop policy if exists sales_os_product_sources_authenticated_update
  on public.sales_os_product_sources;
create policy sales_os_product_sources_authenticated_update
  on public.sales_os_product_sources
  for update to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated')
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');

comment on table public.sales_os_product_sources is
  'Product-scoped source files and text inputs with parsing state and extracted fields.';
