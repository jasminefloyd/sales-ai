create or replace function public.sales_os_prevent_approved_revision_mutation()
returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'sales_os_product_profiles'
     and to_jsonb(old)->>'review_status' = 'approved'
     and to_jsonb(new)->>'review_status' = 'approved'
     and row_to_json(old)::jsonb - 'updated_at' - 'updated_by'
         is distinct from row_to_json(new)::jsonb - 'updated_at' - 'updated_by' then
    raise exception 'Approved product profile revisions are immutable';
  end if;
  if TG_TABLE_NAME in ('sales_os_icps', 'sales_os_audiences', 'sales_os_outreach_decisions')
     and to_jsonb(old)->>'status' in ('approved', 'active')
     and to_jsonb(new)->>'status' = to_jsonb(old)->>'status'
     and row_to_json(old)::jsonb - 'updated_at' - 'updated_by'
         is distinct from row_to_json(new)::jsonb - 'updated_at' - 'updated_by' then
    raise exception 'Approved strategy revisions are immutable';
  end if;
  if TG_TABLE_NAME = 'sales_os_engagements'
     and to_jsonb(old)->>'status' in ('approved', 'executed')
     and to_jsonb(new)->>'status' = to_jsonb(old)->>'status'
     and (old.draft_content, old.final_content) is distinct from
         (new.draft_content, new.final_content) then
    raise exception 'Approved copy revisions are immutable';
  end if;
  return new;
end;
$$;
