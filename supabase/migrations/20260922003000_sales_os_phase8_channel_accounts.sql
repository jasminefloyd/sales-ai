create table public.sales_os_channel_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid,
  platform text not null check (platform in ('reddit', 'community', 'professional_social')),
  external_account_id text not null,
  display_label text not null,
  credential_reference text,
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  unique (tenant_id, platform, external_account_id),
  foreign key (tenant_id, product_id)
    references public.sales_os_products (tenant_id, id) on delete cascade
);

create index sales_os_channel_accounts_scope_idx
  on public.sales_os_channel_accounts (tenant_id, platform, product_id, enabled);

alter table public.sales_os_engagements
  add column channel_account_id uuid,
  add constraint sales_os_engagements_channel_account_fk
    foreign key (tenant_id, channel_account_id)
    references public.sales_os_channel_accounts (tenant_id, id)
    on delete set null;

create index sales_os_engagements_channel_account_idx
  on public.sales_os_engagements (tenant_id, channel_account_id);

create trigger sales_os_channel_accounts_updated_at
  before update on public.sales_os_channel_accounts
  for each row execute function public.sales_os_set_updated_at();

alter table public.sales_os_channel_accounts enable row level security;
create policy sales_os_channel_accounts_tenant_isolation
  on public.sales_os_channel_accounts
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');
create policy sales_os_channel_accounts_authenticated_insert
  on public.sales_os_channel_accounts
  for insert to authenticated
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');

comment on table public.sales_os_channel_accounts is
  'Fixed, tenant-scoped branded identities. Provider credentials remain server-side.';
