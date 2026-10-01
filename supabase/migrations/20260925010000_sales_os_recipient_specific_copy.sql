drop index if exists public.sales_os_engagements_decision_copy_version_unique;

create unique index if not exists sales_os_engagements_decision_opportunity_copy_unique
  on public.sales_os_engagements (tenant_id, outreach_decision_id, opportunity_id, copy_version)
  where outreach_decision_id is not null;

comment on index public.sales_os_engagements_decision_opportunity_copy_unique is
  'Allows one audience-level copy item or one recipient-specific copy item per opportunity and outreach decision revision.';
