-- Native product analytics for the current Sales OS tenant.

create table public.sales_os_admin_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid,
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_]{1,79}$'),
  occurred_at timestamptz not null default now(),
  user_id uuid,
  anonymous_id text,
  session_id text,
  properties jsonb not null default '{}'::jsonb,
  source text not null default 'web' check (source in ('web', 'server', 'stripe', 'system')),
  page_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  sales_attribution_id text,
  sales_opportunity_id uuid,
  sales_engagement_id uuid,
  idempotency_key text,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete set null,
  foreign key (tenant_id, sales_opportunity_id) references public.sales_os_opportunities (tenant_id, id) on delete set null,
  foreign key (tenant_id, sales_engagement_id) references public.sales_os_engagements (tenant_id, id) on delete set null,
  unique (tenant_id, idempotency_key)
);

create index sales_os_admin_events_occurred_idx
  on public.sales_os_admin_events (tenant_id, occurred_at desc);
create index sales_os_admin_events_name_occurred_idx
  on public.sales_os_admin_events (tenant_id, event_name, occurred_at desc);
create index sales_os_admin_events_user_idx
  on public.sales_os_admin_events (tenant_id, user_id, occurred_at desc);
create index sales_os_admin_events_anonymous_idx
  on public.sales_os_admin_events (tenant_id, anonymous_id, occurred_at desc);
create index sales_os_admin_events_attribution_idx
  on public.sales_os_admin_events (tenant_id, sales_attribution_id, occurred_at desc);
create index sales_os_admin_events_opportunity_idx
  on public.sales_os_admin_events (tenant_id, sales_opportunity_id, occurred_at desc);
create index sales_os_admin_events_engagement_idx
  on public.sales_os_admin_events (tenant_id, sales_engagement_id, occurred_at desc);

alter table public.sales_os_admin_events enable row level security;

create policy sales_os_admin_events_authenticated_read
  on public.sales_os_admin_events
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');

create policy sales_os_admin_events_public_track
  on public.sales_os_admin_events
  for insert to anon, authenticated
  with check (
    tenant_id = 'sales_os'
    and source = 'web'
    and event_name not in ('pass_purchased', 'subscription_started', 'subscription_cancelled', 'subscription_renewed', 'payment_failed')
  );

create or replace function public.sales_os_admin_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE'
     and current_setting('sales_os.product_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Sales OS admin analytics events are append-only';
end;
$$;

create trigger sales_os_admin_events_immutable_update
  before update or delete on public.sales_os_admin_events
  for each row execute function public.sales_os_admin_events_immutable();
