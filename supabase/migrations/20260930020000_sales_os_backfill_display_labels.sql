-- Backfill concise, UI-only labels for records created before display_labels existed.
-- This does not change canonical product, ICP, audience, decision, or copy data.

-- display_labels is presentation metadata, so it must not make an approved
-- canonical revision mutable. Preserve the existing lifecycle protections while
-- excluding this UI-only column from their comparisons.
create or replace function public.sales_os_prevent_approved_revision_mutation()
returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'sales_os_product_profiles'
     and to_jsonb(old)->>'review_status' = 'approved'
     and to_jsonb(new)->>'review_status' = 'approved'
     and row_to_json(old)::jsonb - 'updated_at' - 'updated_by' - 'is_active' - 'display_labels'
         is distinct from row_to_json(new)::jsonb - 'updated_at' - 'updated_by' - 'is_active' - 'display_labels' then
    raise exception 'Approved product profile revisions are immutable';
  end if;
  if TG_TABLE_NAME in ('sales_os_icps', 'sales_os_audiences', 'sales_os_outreach_decisions')
     and to_jsonb(old)->>'status' in ('approved', 'active')
     and to_jsonb(new)->>'status' = to_jsonb(old)->>'status'
     and row_to_json(old)::jsonb - 'updated_at' - 'updated_by' - 'display_labels'
         is distinct from row_to_json(new)::jsonb - 'updated_at' - 'updated_by' - 'display_labels' then
    raise exception 'Approved strategy revisions are immutable';
  end if;
  if TG_TABLE_NAME = 'sales_os_engagements'
     and to_jsonb(old)->>'status' in ('approved', 'executed')
     and to_jsonb(new)->>'status' = to_jsonb(old)->>'status'
     and (to_jsonb(old)->>'draft_content', to_jsonb(old)->>'final_content') is distinct from
         (to_jsonb(new)->>'draft_content', to_jsonb(new)->>'final_content') then
    raise exception 'Approved copy revisions are immutable';
  end if;
  return new;
end;
$$;

update public.sales_os_product_profiles
set display_labels = jsonb_strip_nulls(
  coalesce(display_labels, '{}'::jsonb) || jsonb_build_object(
    'schemaVersion', 1,
    'category', nullif(left(trim(category), 72), ''),
    'description', nullif(left(regexp_replace(trim(description), '\s+', ' ', 'g'), 180), '')
  )
)
where coalesce(display_labels, '{}'::jsonb) = '{}'::jsonb;

update public.sales_os_icps
set display_labels = jsonb_strip_nulls(
  coalesce(display_labels, '{}'::jsonb) || jsonb_build_object(
    'schemaVersion', 1,
    'name', nullif(left(trim(name), 72), ''),
    'summary', nullif(left(regexp_replace(trim(summary), '\s+', ' ', 'g'), 180), ''),
    'whyItFits', nullif(left(regexp_replace(trim(why_product_fits), '\s+', ' ', 'g'), 180), '')
  )
)
where coalesce(display_labels, '{}'::jsonb) = '{}'::jsonb;

update public.sales_os_audiences
set display_labels = jsonb_strip_nulls(
  coalesce(display_labels, '{}'::jsonb) || jsonb_build_object(
    'schemaVersion', 1,
    'name', nullif(left(trim(name), 72), ''),
    'summary', nullif(left(regexp_replace(trim(coalesce(audience_summary, problem_use_case_fit)), '\s+', ' ', 'g'), 180), ''),
    'problem', nullif(left(regexp_replace(trim(problem_use_case_fit), '\s+', ' ', 'g'), 180), '')
  )
)
where coalesce(display_labels, '{}'::jsonb) = '{}'::jsonb;

update public.sales_os_outreach_decisions
set display_labels = jsonb_strip_nulls(
  coalesce(display_labels, '{}'::jsonb) || jsonb_build_object(
    'schemaVersion', 1,
    'goal', nullif(left(regexp_replace(trim(coalesce(objective, collateral_type)), '\s+', ' ', 'g'), 120), ''),
    'why', nullif(left(regexp_replace(trim(rationale), '\s+', ' ', 'g'), 180), '')
  )
)
where coalesce(display_labels, '{}'::jsonb) = '{}'::jsonb;
