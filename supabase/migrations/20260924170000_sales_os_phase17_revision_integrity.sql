alter table public.sales_os_audiences
  add column if not exists audience_revision_family uuid default gen_random_uuid();

update public.sales_os_audiences
set audience_revision_family = id
where audience_revision_family is null;

alter table public.sales_os_audiences
  alter column audience_revision_family set not null;

create unique index if not exists sales_os_audiences_revision_unique
  on public.sales_os_audiences (tenant_id, audience_revision_family, audience_version);

create unique index if not exists sales_os_engagements_decision_copy_version_unique
  on public.sales_os_engagements (tenant_id, outreach_decision_id, copy_version)
  where outreach_decision_id is not null;

comment on index public.sales_os_audiences_revision_unique is
  'Each audience revision family may have only one record for a given version.';
comment on index public.sales_os_engagements_decision_copy_version_unique is
  'Each outreach decision may have only one generated copy revision.';

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

drop trigger if exists sales_os_product_profiles_revision_immutable on public.sales_os_product_profiles;
create trigger sales_os_product_profiles_revision_immutable
  before update on public.sales_os_product_profiles
  for each row execute function public.sales_os_prevent_approved_revision_mutation();

drop trigger if exists sales_os_icps_revision_immutable on public.sales_os_icps;
create trigger sales_os_icps_revision_immutable
  before update on public.sales_os_icps
  for each row execute function public.sales_os_prevent_approved_revision_mutation();

drop trigger if exists sales_os_audiences_revision_immutable on public.sales_os_audiences;
create trigger sales_os_audiences_revision_immutable
  before update on public.sales_os_audiences
  for each row execute function public.sales_os_prevent_approved_revision_mutation();

drop trigger if exists sales_os_outreach_decisions_revision_immutable on public.sales_os_outreach_decisions;
create trigger sales_os_outreach_decisions_revision_immutable
  before update on public.sales_os_outreach_decisions
  for each row execute function public.sales_os_prevent_approved_revision_mutation();

drop trigger if exists sales_os_engagements_revision_immutable on public.sales_os_engagements;
create trigger sales_os_engagements_revision_immutable
  before update on public.sales_os_engagements
  for each row execute function public.sales_os_prevent_approved_revision_mutation();
