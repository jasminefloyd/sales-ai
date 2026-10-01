-- Align applied contracts with the documented learning and attribution model.
alter table public.sales_os_learning_configurations
  drop constraint if exists sales_os_learning_configurations_target_key_check;
alter table public.sales_os_learning_configurations
  add constraint sales_os_learning_configurations_target_key_check check (target_key in (
    'audience_priority', 'audience_status', 'route_priority', 'source_priority',
    'signal_weight', 'contact_role_preference', 'message_angle_preference',
    'cta_preference', 'follow_up_cadence', 'provider_priority',
    'evidence_score_rubric'
  ));

alter table public.sales_os_product_profiles
  drop constraint if exists sales_os_product_profiles_created_by_check;
alter table public.sales_os_product_profiles
  add constraint sales_os_product_profiles_created_by_check
  check (created_by = 'ai' or created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

alter table public.sales_os_conversion_attribution_history
  add column if not exists product_id uuid;
update public.sales_os_conversion_attribution_history history
set product_id = conversions.product_id
from public.sales_os_conversions conversions
where conversions.tenant_id = history.tenant_id
  and conversions.id = history.conversion_id
  and history.product_id is null;
alter table public.sales_os_conversion_attribution_history
  add constraint sales_os_conversion_attribution_history_product_fk
  foreign key (tenant_id, product_id)
  references public.sales_os_products (tenant_id, id)
  on delete cascade;
create index if not exists sales_os_conversion_attribution_history_product_idx
  on public.sales_os_conversion_attribution_history (tenant_id, product_id, created_at desc);

create or replace function public.sales_os_score_evidence(
  evidence_count integer,
  source_diversity integer,
  signal_specificity numeric,
  recency_days numeric
)
returns jsonb
language sql
immutable
as $$
  with normalized as (
    select
      least(1, greatest(0, evidence_count / 4.0)) as evidence_count,
      least(1, greatest(0, source_diversity / 3.0)) as source_diversity,
      least(1, greatest(0, signal_specificity)) as signal_specificity,
      least(1, greatest(0, 1 - recency_days / 90.0)) as recency
  ), weighted as (
    select *, evidence_count * .25 + source_diversity * .25 + signal_specificity * .25 + recency * .25 as total
    from normalized
  )
  select jsonb_build_object(
    'rubricVersion', 'evidence_v1',
    'weightedTotal', total,
    'score', case when total >= .75 then 'high' when total >= .45 then 'medium' else 'low' end,
    'normalized', jsonb_build_object('evidenceCount', evidence_count, 'sourceDiversity', source_diversity, 'signalSpecificity', signal_specificity, 'recency', recency)
  ) from weighted;
$$;
