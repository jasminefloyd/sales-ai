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

create or replace function public.sales_os_workflow_lineage_immutable()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE'
     and current_setting('sales_os.product_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Sales OS workflow lineage is append-only';
end;
$$;

create or replace function public.sales_os_delete_product(
  p_product_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_product_name text;
begin
  perform set_config('sales_os.product_cleanup', 'on', true);

  select name into deleted_product_name
  from public.sales_os_products
  where tenant_id = 'sales_os' and id = p_product_id
  for update;

  if deleted_product_name is null then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  delete from public.sales_os_admin_events where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_conversion_attribution_history where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_conversions where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_events where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_approvals where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_learning_configurations where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_learnings where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_engagements where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_conversations where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_opportunities where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_suppression_records where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_audience_routes where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_signals where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_audiences where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_icps where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_contacts where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_accounts where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_sources where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_product_sources where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_product_profile_provenance where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_product_profiles where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_provider_runs where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_budget_reservations where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_jobs where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_operating_settings where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_channel_accounts where tenant_id = 'sales_os' and product_id = p_product_id;
  delete from public.sales_os_products where tenant_id = 'sales_os' and id = p_product_id;

  return jsonb_build_object('deleted', true, 'productId', p_product_id, 'productName', deleted_product_name, 'actor', p_actor);
end;
$$;
