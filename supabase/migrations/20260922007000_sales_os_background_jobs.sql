alter table public.sales_os_jobs
  add column attempt integer not null default 0 check (attempt >= 0),
  add column max_attempts integer not null default 3 check (max_attempts > 0),
  add column next_run_at timestamptz,
  add column last_heartbeat_at timestamptz,
  add column cancel_requested boolean not null default false,
  add column idempotency_key text;

create unique index sales_os_jobs_idempotency_unique
  on public.sales_os_jobs (tenant_id, product_id, idempotency_key)
  where idempotency_key is not null;

create index sales_os_jobs_claim_idx
  on public.sales_os_jobs (tenant_id, status, next_run_at, created_at);

create or replace function public.sales_os_claim_next_job(p_worker_id text)
returns setof public.sales_os_jobs
language plpgsql
security invoker
as $$
begin
  return query
  with candidate as (
    select id
    from public.sales_os_jobs
    where tenant_id = 'sales_os'
      and status = 'queued'
      and (next_run_at is null or next_run_at <= now())
      and cancel_requested = false
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.sales_os_jobs jobs
  set status = 'running',
      attempt = jobs.attempt + 1,
      last_heartbeat_at = now(),
      updated_by = p_worker_id,
      state_changed_by = p_worker_id
  from candidate
  where jobs.id = candidate.id
  returning jobs.*;
end;
$$;

comment on function public.sales_os_claim_next_job(text) is
  'Atomically claims one queued Sales OS job for a worker using row locking.';

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
  if p_entity_type = 'job' and p_old_status = 'failed' and p_new_status in ('queued', 'cancelled') then
    return;
  end if;
  if not (
    (p_entity_type = 'product' and ((p_old_status = 'draft' and p_new_status in ('analyzing', 'paused')) or (p_old_status = 'analyzing' and p_new_status in ('audience_review', 'paused')) or (p_old_status = 'audience_review' and p_new_status in ('active', 'paused')) or (p_old_status = 'active' and p_new_status = 'paused') or (p_old_status = 'paused' and p_new_status = 'active'))) or
    (p_entity_type = 'audience' and ((p_old_status = 'proposed' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('active', 'paused', 'rejected')) or (p_old_status = 'active' and p_new_status = 'paused') or (p_old_status = 'paused' and p_new_status in ('active', 'rejected')))) or
    (p_entity_type = 'opportunity' and ((p_old_status = 'discovered' and p_new_status in ('qualified', 'rejected', 'closed')) or (p_old_status = 'qualified' and p_new_status in ('awaiting_review', 'rejected', 'closed')) or (p_old_status = 'awaiting_review' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('engagement_pending', 'rejected', 'closed')) or (p_old_status = 'engagement_pending' and p_new_status in ('engaged', 'rejected', 'closed')) or (p_old_status = 'engaged' and p_new_status in ('responded', 'converted', 'closed')) or (p_old_status = 'responded' and p_new_status in ('converted', 'closed')))) or
    (p_entity_type = 'engagement' and ((p_old_status = 'drafted' and p_new_status in ('awaiting_approval', 'rejected', 'cancelled')) or (p_old_status = 'awaiting_approval' and p_new_status in ('approved', 'rejected', 'cancelled')) or (p_old_status = 'approved' and p_new_status in ('queued', 'cancelled')) or (p_old_status = 'queued' and p_new_status in ('executed', 'failed', 'cancelled')) or (p_old_status = 'failed' and p_new_status in ('queued', 'cancelled')))) or
    (p_entity_type = 'learning' and ((p_old_status = 'detected' and p_new_status in ('proposed', 'rejected')) or (p_old_status = 'proposed' and p_new_status in ('approved', 'rejected')) or (p_old_status = 'approved' and p_new_status in ('active', 'rejected')) or (p_old_status = 'active' and p_new_status = 'superseded'))) or
    (p_entity_type = 'approval' and ((p_old_status = 'pending' and p_new_status in ('approved', 'rejected', 'expired')) or (p_old_status = 'approved' and p_new_status = 'executed'))) or
    (p_entity_type = 'job' and ((p_old_status = 'queued' and p_new_status in ('running', 'cancelled')) or (p_old_status = 'running' and p_new_status in ('paused_budget', 'waiting_approval', 'completed', 'failed', 'cancelled')) or (p_old_status = 'paused_budget' and p_new_status in ('queued', 'cancelled')) or (p_old_status = 'waiting_approval' and p_new_status in ('queued', 'cancelled'))))
  ) then
    raise exception 'Invalid % transition: % -> %', p_entity_type, p_old_status, p_new_status;
  end if;
end;
$$;
