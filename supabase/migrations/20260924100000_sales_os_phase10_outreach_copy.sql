alter table public.sales_os_engagements
  alter column opportunity_id drop not null;

alter table public.sales_os_engagements
  add column if not exists outreach_decision_id uuid,
  add column if not exists icp_id uuid,
  add column if not exists audience_id uuid,
  add column if not exists product_profile_id uuid,
  add column if not exists copy_version integer not null default 1;

alter table public.sales_os_engagements
  add constraint sales_os_engagements_source_check
  check (opportunity_id is not null or outreach_decision_id is not null);

alter table public.sales_os_engagements
  add constraint sales_os_engagements_decision_fk
  foreign key (tenant_id, outreach_decision_id)
  references public.sales_os_outreach_decisions (tenant_id, id) on delete cascade;

alter table public.sales_os_engagements
  add constraint sales_os_engagements_icp_fk
  foreign key (tenant_id, icp_id)
  references public.sales_os_icps (tenant_id, id) on delete set null;

alter table public.sales_os_engagements
  add constraint sales_os_engagements_audience_fk
  foreign key (tenant_id, audience_id)
  references public.sales_os_audiences (tenant_id, id) on delete set null;

alter table public.sales_os_engagements
  add constraint sales_os_engagements_profile_fk
  foreign key (tenant_id, product_profile_id)
  references public.sales_os_product_profiles (tenant_id, id) on delete set null;

create index if not exists sales_os_engagements_decision_idx
  on public.sales_os_engagements (tenant_id, outreach_decision_id, status);
