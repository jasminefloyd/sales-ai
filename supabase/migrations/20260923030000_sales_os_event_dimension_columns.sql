-- First-class learning and analytics dimensions. JSONB remains available for
-- additional provider-specific context, while these fields stay consistent.
alter table public.sales_os_events
  add column if not exists contact_role text,
  add column if not exists message_angle text,
  add column if not exists cta text,
  add column if not exists follow_up_cadence text;

create index if not exists sales_os_events_dimension_lookup_idx
  on public.sales_os_events (tenant_id, product_id, audience_id, source_id, signal_id);
