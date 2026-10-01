-- Sales OS Audience Intelligence Phase 4: deterministic identity resolution.

alter table public.sales_os_accounts
  add column if not exists crm_record_id text,
  add column if not exists provider_record_id text,
  add column if not exists identity_state text not null default 'canonical'
    check (identity_state in ('canonical', 'candidate', 'merged', 'archived')),
  add column if not exists merged_into_account_id uuid;

alter table public.sales_os_contacts
  add column if not exists phone text,
  add column if not exists normalized_phone text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'), '')
  ) stored,
  add column if not exists crm_record_id text,
  add column if not exists provider_record_id text,
  add column if not exists identity_state text not null default 'canonical'
    check (identity_state in ('canonical', 'candidate', 'merged', 'archived')),
  add column if not exists merged_into_contact_id uuid;

alter table public.sales_os_identity_candidates
  add column if not exists match_type text not null default 'candidate'
    check (match_type in ('deterministic', 'candidate')),
  add column if not exists threshold_version text not null default 'identity_v1';

alter table public.sales_os_identity_merges
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists conflict_resolution jsonb not null default '{}'::jsonb,
  add column if not exists merge_key text,
  add column if not exists reverted_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_accounts_merged_into_fk'
      and conrelid = 'public.sales_os_accounts'::regclass
  ) then
    alter table public.sales_os_accounts
      add constraint sales_os_accounts_merged_into_fk
      foreign key (tenant_id, merged_into_account_id)
      references public.sales_os_accounts (tenant_id, id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_os_contacts_merged_into_fk'
      and conrelid = 'public.sales_os_contacts'::regclass
  ) then
    alter table public.sales_os_contacts
      add constraint sales_os_contacts_merged_into_fk
      foreign key (tenant_id, merged_into_contact_id)
      references public.sales_os_contacts (tenant_id, id) on delete set null;
  end if;
end $$;

create unique index if not exists sales_os_accounts_crm_record_unique
  on public.sales_os_accounts (tenant_id, product_id, crm_record_id)
  where crm_record_id is not null;
create unique index if not exists sales_os_accounts_provider_record_unique
  on public.sales_os_accounts (tenant_id, product_id, provider_record_id)
  where provider_record_id is not null;
create unique index if not exists sales_os_contacts_phone_unique
  on public.sales_os_contacts (tenant_id, product_id, normalized_phone)
  where normalized_phone is not null;
create unique index if not exists sales_os_contacts_crm_record_unique
  on public.sales_os_contacts (tenant_id, product_id, crm_record_id)
  where crm_record_id is not null;
create unique index if not exists sales_os_contacts_provider_record_unique
  on public.sales_os_contacts (tenant_id, product_id, provider_record_id)
  where provider_record_id is not null;
create unique index if not exists sales_os_identity_merges_key_unique
  on public.sales_os_identity_merges (tenant_id, merge_key)
  where merge_key is not null and status in ('pending', 'approved');

create index if not exists sales_os_contacts_identity_lookup_idx
  on public.sales_os_contacts (tenant_id, product_id, normalized_email, normalized_phone, identity_state);
create index if not exists sales_os_identity_candidates_review_idx
  on public.sales_os_identity_candidates (tenant_id, product_id, status, match_type, confidence desc);

comment on column public.sales_os_identity_candidates.match_type is
  'Deterministic matches may be auto-linked; candidate matches require human review.';
comment on column public.sales_os_identity_merges.source_snapshot is
  'Pre-merge source record snapshot used to make the merge reversible.';
comment on column public.sales_os_identity_merges.target_snapshot is
  'Pre-merge target record snapshot used to make the merge reversible.';
