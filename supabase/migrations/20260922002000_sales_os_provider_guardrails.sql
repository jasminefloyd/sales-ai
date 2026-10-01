-- Sales OS Phase 3: provider-run accounting and atomic budget reservations.

create table public.sales_os_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  job_id uuid,
  estimated_cost numeric(12, 4) not null check (estimated_cost >= 0),
  period_start date not null default date_trunc('month', now())::date,
  status text not null default 'reserved' check (status in ('reserved', 'released', 'consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references public.sales_os_jobs (tenant_id, id) on delete set null
);

create index sales_os_budget_reservations_active_idx
  on public.sales_os_budget_reservations (tenant_id, product_id, period_start, status);

alter table public.sales_os_budget_reservations enable row level security;
create policy sales_os_budget_reservations_tenant_isolation
  on public.sales_os_budget_reservations
  for select to authenticated
  using (tenant_id = 'sales_os' and auth.role() = 'authenticated');
create policy sales_os_budget_reservations_authenticated_insert
  on public.sales_os_budget_reservations
  for insert to authenticated
  with check (tenant_id = 'sales_os' and auth.role() = 'authenticated');

create trigger sales_os_budget_reservations_updated_at
  before update on public.sales_os_budget_reservations
  for each row execute function public.sales_os_set_updated_at();

create or replace function public.sales_os_validate_transition(
  p_entity_type text,
  p_old_status text,
  p_new_status text
)
returns void
language plpgsql
immutable
as $$
begin
  if p_old_status = p_new_status then
    return;
  end if;

  if not (
    (p_entity_type = 'product' and ((p_old_status = 'draft' and p_new_status in ('analyzing', 'paused')) or (p_old_status = 'analyzing' and p_new_status in ('audience_review', 'paused')) or (p_old_status = 'audience_review' and p_new_status in ('active', 'paused')) or (p_old_status = 'active' and p_new_status = 'paused') or (p_old_status = 'paused' and p_new_status = 'active'))) or
    (p_entity_type = 'audience' and ((p_old_status = 'proposed' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('active', 'paused', 'rejected')) or (p_old_status = 'active' and p_new_status = 'paused') or (p_old_status = 'paused' and p_new_status in ('active', 'rejected')))) or
    (p_entity_type = 'opportunity' and ((p_old_status = 'discovered' and p_new_status in ('qualified', 'rejected', 'closed')) or (p_old_status = 'qualified' and p_new_status in ('awaiting_review', 'rejected', 'closed')) or (p_old_status = 'awaiting_review' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('engagement_pending', 'rejected', 'closed')) or (p_old_status = 'engagement_pending' and p_new_status in ('engaged', 'rejected', 'closed')) or (p_old_status = 'engaged' and p_new_status in ('responded', 'converted', 'closed')) or (p_old_status = 'responded' and p_new_status in ('converted', 'closed')))) or
    (p_entity_type = 'engagement' and ((p_old_status = 'drafted' and p_new_status in ('awaiting_approval', 'rejected', 'cancelled')) or (p_old_status = 'awaiting_approval' and p_new_status in ('approved', 'rejected', 'cancelled')) or (p_old_status = 'approved' and p_new_status in ('queued', 'cancelled')) or (p_old_status = 'queued' and p_new_status in ('executed', 'failed', 'cancelled')) or (p_old_status = 'failed' and p_new_status in ('queued', 'cancelled')))) or
    (p_entity_type = 'learning' and ((p_old_status = 'detected' and p_new_status in ('proposed', 'rejected')) or (p_old_status = 'proposed' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('active', 'rejected')) or (p_old_status = 'active' and p_new_status = 'superseded'))) or
    (p_entity_type = 'approval' and ((p_old_status = 'pending' and p_new_status in ('approved', 'rejected', 'expired')) or (p_old_status = 'approved' and p_new_status = 'executed'))) or
    (p_entity_type = 'job' and ((p_old_status = 'queued' and p_new_status in ('running', 'paused_budget', 'cancelled')) or (p_old_status = 'running' and p_new_status in ('paused_budget', 'waiting_approval', 'completed', 'failed', 'cancelled')) or (p_old_status = 'paused_budget' and p_new_status in ('queued', 'cancelled')) or (p_old_status = 'waiting_approval' and p_new_status in ('queued', 'cancelled'))))
  ) then
    raise exception 'Invalid % transition: % -> %', p_entity_type, p_old_status, p_new_status;
  end if;
end;
$$;

create or replace function public.sales_os_check_budget(
  p_product_id uuid,
  p_estimated_cost numeric,
  p_job_id uuid default null,
  p_requested_by text default 'system'
)
returns table (
  allowed boolean,
  reason text,
  reservation_id uuid,
  monthly_spend numeric,
  active_reservations numeric,
  requested_cost numeric,
  monthly_cap numeric,
  per_run_cap numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  product_record record;
  current_month_start timestamptz := date_trunc('month', now());
  spend numeric := 0;
  reserved numeric := 0;
  reservation uuid;
  denial_reason text;
begin
  if p_estimated_cost is null or p_estimated_cost < 0 then
    raise exception 'Estimated cost must be a non-negative number';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sales_os_budget:' || p_product_id::text, 0));

  select monthly_spend_cap, per_run_spend_cap
    into product_record
    from public.sales_os_products
   where tenant_id = 'sales_os' and id = p_product_id;

  if not found then
    raise exception 'Sales OS product not found: %', p_product_id;
  end if;

  select coalesce(sum(coalesce(actual_cost, estimated_cost)), 0)
    into spend
    from public.sales_os_provider_runs
   where tenant_id = 'sales_os'
     and product_id = p_product_id
     and started_at >= current_month_start
     and status <> 'skipped_budget';

  select coalesce(sum(estimated_cost), 0)
    into reserved
    from public.sales_os_budget_reservations
   where tenant_id = 'sales_os'
     and product_id = p_product_id
     and period_start = current_month_start::date
     and status = 'reserved';

  if product_record.per_run_spend_cap is not null and p_estimated_cost > product_record.per_run_spend_cap then
    denial_reason := 'per_run_cap_exceeded';
  elsif product_record.monthly_spend_cap is not null and spend + reserved + p_estimated_cost > product_record.monthly_spend_cap then
    denial_reason := 'monthly_cap_exceeded';
  end if;

  if denial_reason is not null then
    if p_job_id is not null then
      update public.sales_os_jobs
         set status = 'paused_budget', updated_by = p_requested_by, state_changed_by = p_requested_by
       where tenant_id = 'sales_os' and id = p_job_id and status in ('queued', 'running');
    end if;
    return query select false, denial_reason, null::uuid, spend, reserved, p_estimated_cost, product_record.monthly_spend_cap, product_record.per_run_spend_cap;
    return;
  end if;

  insert into public.sales_os_budget_reservations
    (tenant_id, product_id, job_id, estimated_cost, period_start, status, created_by, updated_by)
  values
    ('sales_os', p_product_id, p_job_id, p_estimated_cost, current_month_start::date, 'reserved', p_requested_by, p_requested_by)
  returning id into reservation;

  return query select true, 'reserved', reservation, spend, reserved, p_estimated_cost, product_record.monthly_spend_cap, product_record.per_run_spend_cap;
end;
$$;

revoke all on function public.sales_os_check_budget(uuid, numeric, uuid, text) from public;
grant execute on function public.sales_os_check_budget(uuid, numeric, uuid, text) to service_role;
