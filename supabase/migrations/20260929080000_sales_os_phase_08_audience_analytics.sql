-- Sales OS Audience Intelligence Phase 8: lifecycle analytics instrumentation.

create index if not exists sales_os_events_audience_lifecycle_idx
  on public.sales_os_events (tenant_id, product_id, event_type, audience_id, occurred_at desc);
create index if not exists sales_os_events_signal_provider_idx
  on public.sales_os_events (tenant_id, product_id, signal_id, provider_id, occurred_at desc);
create index if not exists sales_os_activation_records_analytics_idx
  on public.sales_os_activation_records (tenant_id, product_id, status, synced_at desc);
create index if not exists sales_os_activation_sync_runs_analytics_idx
  on public.sales_os_activation_sync_runs (tenant_id, product_id, status, created_at desc);

create or replace function public.sales_os_phase8_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return value::uuid;
end;
$$;

create or replace function public.sales_os_capture_audience_lifecycle_event()
returns trigger
language plpgsql
as $$
declare
  row_data jsonb := to_jsonb(new);
  old_data jsonb := case when TG_OP = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  event_type text;
  entity_id text := coalesce(row_data->>'id', gen_random_uuid()::text);
  current_status text := coalesce(row_data->>'status', 'unknown');
  previous_status text := coalesce(old_data->>'status', '');
  occurred_at timestamptz := coalesce(
    nullif(row_data->>'updated_at', '')::timestamptz,
    nullif(row_data->>'calculated_at', '')::timestamptz,
    nullif(row_data->>'synced_at', '')::timestamptz,
    now()
  );
begin
  if TG_TABLE_NAME = 'sales_os_audience_members' then
    if TG_OP = 'INSERT' then event_type := 'audience_member_discovered';
    elsif TG_OP = 'UPDATE' and (
      row_data->>'account_id' is distinct from old_data->>'account_id'
      or row_data->>'contact_id' is distinct from old_data->>'contact_id'
    ) and (row_data->>'account_id' is not null or row_data->>'contact_id' is not null) then event_type := 'audience_member_resolved';
    elsif current_status in ('needs_enrichment', 'stale') then event_type := 'audience_member_enrichment_needed';
    elsif current_status = 'ready' then event_type := 'audience_member_ready';
    elsif current_status is distinct from previous_status then event_type := 'audience_member_state_changed';
    end if;
  elsif TG_TABLE_NAME = 'sales_os_enrichment_records' then
    event_type := case current_status when 'succeeded' then 'audience_member_enriched' when 'failed' then 'audience_member_enrichment_failed' else 'audience_member_enrichment_observed' end;
  elsif TG_TABLE_NAME = 'sales_os_identity_candidates' then
    event_type := case current_status when 'accepted' then 'identity_resolved' when 'rejected' then 'identity_rejected' else 'identity_candidate_created' end;
  elsif TG_TABLE_NAME = 'sales_os_audience_quality_snapshots' then
    event_type := case row_data->>'readiness_state' when 'ready' then 'audience_member_ready' else 'audience_quality_state_changed' end;
  elsif TG_TABLE_NAME = 'sales_os_activation_records' then
    event_type := case current_status when 'synced' then 'activation_member_synced' when 'failed' then 'activation_member_failed' when 'suppressed' then 'activation_member_suppressed' else 'activation_member_observed' end;
  elsif TG_TABLE_NAME = 'sales_os_activation_sync_runs' then
    event_type := case current_status when 'completed' then 'activation_sync_reconciled' when 'partial' then 'activation_sync_partial' when 'failed' then 'activation_sync_failed' else 'activation_sync_observed' end;
  elsif TG_TABLE_NAME = 'sales_os_provider_runs' then
    event_type := case current_status when 'succeeded' then 'provider_run_succeeded' when 'failed' then 'provider_run_failed' else 'provider_run_observed' end;
  end if;
  if TG_OP = 'UPDATE'
     and TG_TABLE_NAME in ('sales_os_enrichment_records', 'sales_os_identity_candidates', 'sales_os_activation_records', 'sales_os_activation_sync_runs', 'sales_os_provider_runs')
     and current_status = previous_status then
    return new;
  end if;
  if event_type is null then return new; end if;

  insert into public.sales_os_events (
    tenant_id, product_id, event_type, occurred_at, audience_id, account_id,
    contact_id, signal_id, provider_id, dimensions, idempotency_key, created_by
  ) values (
    new.tenant_id,
    new.product_id,
    event_type,
    occurred_at,
    public.sales_os_phase8_uuid(row_data->>'audience_id'),
    public.sales_os_phase8_uuid(row_data->>'account_id'),
    public.sales_os_phase8_uuid(row_data->>'contact_id'),
    public.sales_os_phase8_uuid(row_data->>'signal_id'),
    public.sales_os_phase8_uuid(row_data->>'provider_id'),
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'recordId', entity_id,
      'memberId', row_data->>'member_id',
      'activationId', row_data->>'activation_id',
      'definitionId', row_data->>'definition_id',
      'status', current_status,
      'previousStatus', previous_status,
      'confidence', row_data->>'confidence',
      'matchRate', row_data->>'synced_count',
      'failedCount', row_data->>'failed_count',
      'capability', row_data->>'capability'
    ),
    'phase8:' || TG_TABLE_NAME || ':' || entity_id || ':' || event_type || ':' || occurred_at::text,
    coalesce(row_data->>'updated_by', row_data->>'created_by', 'system')
  ) on conflict (tenant_id, product_id, idempotency_key) do nothing;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_os_audience_members', 'sales_os_enrichment_records',
    'sales_os_identity_candidates', 'sales_os_audience_quality_snapshots',
    'sales_os_activation_records', 'sales_os_activation_sync_runs',
    'sales_os_provider_runs'
  ] loop
    execute format('drop trigger if exists sales_os_phase8_lifecycle_%s on public.%I', table_name, table_name);
    execute format('create trigger sales_os_phase8_lifecycle_%s after insert or update on public.%I for each row execute function public.sales_os_capture_audience_lifecycle_event()', table_name, table_name);
  end loop;
end $$;

comment on function public.sales_os_capture_audience_lifecycle_event() is
  'Append-only lifecycle instrumentation for audience, identity, quality, activation, sync, and provider stages.';
comment on table public.sales_os_events is
  'Sales OS analytics events use UTC occurred_at timestamps; first-touch and last-touch attribution remain separate dimensions.';
