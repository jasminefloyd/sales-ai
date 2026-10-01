-- Repair the shared timestamp trigger for schema drift.
-- Some deployed Sales OS tables do not expose updated_at. A polymorphic trigger
-- function must not dereference NEW.updated_at directly because PostgreSQL
-- resolves that field against the triggering table at runtime.

create or replace function public.sales_os_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) ? 'updated_at' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_at', now()));
  end if;
  return new;
end;
$$;

-- Remove timestamp triggers that were previously installed on a table without
-- an updated_at column. Tables that do have the column retain the trigger.
do $$
declare
  target_table text;
  has_updated_at boolean;
begin
  foreach target_table in array array[
    'sales_os_products', 'sales_os_providers', 'sales_os_jobs',
    'sales_os_product_profiles', 'sales_os_audiences', 'sales_os_audience_routes',
    'sales_os_sources', 'sales_os_signals', 'sales_os_accounts', 'sales_os_contacts',
    'sales_os_opportunities', 'sales_os_engagements', 'sales_os_conversations',
    'sales_os_suppression_records', 'sales_os_approvals', 'sales_os_conversions',
    'sales_os_learnings', 'sales_os_provider_runs'
  ] loop
    select exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = target_table
        and c.column_name = 'updated_at'
    ) into has_updated_at;

    if to_regclass(format('public.%I', target_table)) is not null
       and not has_updated_at then
      execute format(
        'drop trigger if exists %I on public.%I',
        target_table || '_updated_at',
        target_table
      );
    end if;
  end loop;
end;
$$;
