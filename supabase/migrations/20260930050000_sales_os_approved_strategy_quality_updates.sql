-- Approved strategy revisions remain immutable, but quality calculation is a
-- post-approval operational process. The quality worker must be able to update
-- these fields on an approved audience without changing its strategy revision.

create or replace function public.sales_os_prevent_approved_revision_mutation()
returns trigger
language plpgsql
as $$
declare
  old_row jsonb := row_to_json(old)::jsonb;
  new_row jsonb := row_to_json(new)::jsonb;
begin
  if TG_TABLE_NAME = 'sales_os_product_profiles'
     and old_row->>'review_status' = 'approved'
     and new_row->>'review_status' = 'approved'
     and old_row - array['updated_at', 'updated_by', 'is_active']
         is distinct from new_row - array['updated_at', 'updated_by', 'is_active'] then
    raise exception 'Approved product profile revisions are immutable';
  end if;

  if TG_TABLE_NAME = 'sales_os_icps'
     and old_row->>'status' in ('approved', 'active')
     and new_row->>'status' = old_row->>'status'
     and old_row - array['updated_at', 'updated_by']
         is distinct from new_row - array['updated_at', 'updated_by'] then
    raise exception 'Approved strategy revisions are immutable';
  end if;

  if TG_TABLE_NAME = 'sales_os_audiences'
     and old_row->>'status' in ('approved', 'active')
     and new_row->>'status' = old_row->>'status'
     and old_row - array[
       'updated_at',
       'updated_by',
       'quality_state',
       'quality_score',
       'quality_last_calculated_at',
       'quality_calculation_version'
     ] is distinct from new_row - array[
       'updated_at',
       'updated_by',
       'quality_state',
       'quality_score',
       'quality_last_calculated_at',
       'quality_calculation_version'
     ] then
    raise exception 'Approved strategy revisions are immutable';
  end if;

  if TG_TABLE_NAME = 'sales_os_outreach_decisions'
     and old_row->>'status' in ('approved', 'active')
     and new_row->>'status' = old_row->>'status'
     and old_row - array['updated_at', 'updated_by']
         is distinct from new_row - array['updated_at', 'updated_by'] then
    raise exception 'Approved strategy revisions are immutable';
  end if;

  if TG_TABLE_NAME = 'sales_os_engagements'
     and old_row->>'status' in ('approved', 'executed')
     and new_row->>'status' = old_row->>'status'
     and (old_row->>'draft_content', old_row->>'final_content') is distinct from
         (new_row->>'draft_content', new_row->>'final_content') then
    raise exception 'Approved copy revisions are immutable';
  end if;

  return new;
end;
$$;

