-- Every approved/active audience must have a versioned definition before it can
-- be previewed or activated. Backfill definitions for audiences created before
-- the definition-creation path was wired into approval.

insert into public.sales_os_audience_definitions (
  tenant_id, product_id, icp_id, audience_id, version, definition_kind,
  name, description, rule_definition, source_system, source_record_id,
  confidence, provenance, consent_state, status, created_by, updated_by
)
select
  audience.tenant_id,
  audience.product_id,
  audience.icp_id,
  audience.id,
  coalesce(audience.audience_version, 1),
  'snapshot',
  audience.name,
  audience.problem_use_case_fit,
  jsonb_build_object(
    'buyerType', audience.buyer_type,
    'audienceVersion', audience.audience_version
  ),
  'sales_os',
  audience.id,
  0.8,
  jsonb_build_array(jsonb_build_object(
    'source', 'approved_audience',
    'audienceId', audience.id
  )),
  'unknown',
  'active',
  coalesce(audience.created_by, 'system'),
  coalesce(audience.updated_by, audience.created_by, 'system')
from public.sales_os_audiences audience
where audience.tenant_id = 'sales_os'
  and audience.status in ('approved', 'active')
  and not exists (
    select 1
    from public.sales_os_audience_definitions definition
    where definition.tenant_id = audience.tenant_id
      and definition.product_id = audience.product_id
      and definition.audience_id = audience.id
      and definition.version = coalesce(audience.audience_version, 1)
  )
on conflict do nothing;
