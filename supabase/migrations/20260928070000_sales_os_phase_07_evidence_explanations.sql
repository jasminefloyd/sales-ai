-- Sales OS Audience Intelligence Phase 7: evidence-backed explanations.

create table if not exists public.sales_os_evidence_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'sales_os' check (tenant_id = 'sales_os'),
  product_id uuid not null,
  subject_type text not null check (subject_type in (
    'product_profile', 'icp', 'audience', 'signal', 'account', 'contact',
    'intent_score', 'opportunity', 'outreach_decision', 'engagement'
  )),
  subject_id uuid not null,
  source_reference text,
  source_type text not null default 'unknown',
  source_url text,
  source_snippet text,
  evidence_status text not null check (evidence_status in (
    'known', 'researched', 'inferred', 'unknown', 'insufficient'
  )),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  explanation text not null,
  snapshot jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  content_hash text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unique (tenant_id, product_id, subject_type, subject_id, content_hash),
  foreign key (tenant_id, product_id) references public.sales_os_products (tenant_id, id) on delete cascade
);

create index if not exists sales_os_evidence_subject_idx
  on public.sales_os_evidence_records (tenant_id, product_id, subject_type, subject_id, created_at desc);
create index if not exists sales_os_evidence_source_idx
  on public.sales_os_evidence_records (tenant_id, product_id, source_type, evidence_status);

alter table public.sales_os_evidence_records enable row level security;
drop policy if exists sales_os_evidence_select on public.sales_os_evidence_records;
create policy sales_os_evidence_select on public.sales_os_evidence_records
  for select using (tenant_id = 'sales_os' and auth.uid() is not null);
drop policy if exists sales_os_evidence_insert on public.sales_os_evidence_records;
create policy sales_os_evidence_insert on public.sales_os_evidence_records
  for insert with check (tenant_id = 'sales_os' and auth.uid() is not null);

create or replace function public.sales_os_capture_evidence_snapshot()
returns trigger
language plpgsql
as $$
declare
  row_data jsonb := to_jsonb(new);
  evidence jsonb := '[]'::jsonb;
  item jsonb;
  subject_type text;
  evidence_status text;
  confidence text;
  source_type text;
  source_url text;
  source_snippet text;
  observed_at timestamptz;
  snapshot jsonb;
  hash text;
begin
  subject_type := case TG_TABLE_NAME
    when 'sales_os_product_profiles' then 'product_profile'
    when 'sales_os_icps' then 'icp'
    when 'sales_os_audiences' then 'audience'
    when 'sales_os_signals' then 'signal'
    when 'sales_os_accounts' then 'account'
    when 'sales_os_contacts' then 'contact'
    when 'sales_os_intent_scores' then 'intent_score'
    when 'sales_os_opportunities' then 'opportunity'
    when 'sales_os_outreach_decisions' then 'outreach_decision'
    when 'sales_os_engagements' then 'engagement'
  end;
  evidence := coalesce(
    row_data->'source_evidence',
    row_data->'supporting_evidence',
    row_data->'evidence',
    row_data->'evidence_context',
    '[]'::jsonb
  );
  if jsonb_typeof(evidence) <> 'array' then evidence := '[]'::jsonb; end if;
  if jsonb_array_length(evidence) = 0 then evidence := jsonb_build_array('{}'::jsonb); end if;

  for item in select value from jsonb_array_elements(evidence)
  loop
    snapshot := case when item = '{}'::jsonb then jsonb_build_object('missingEvidence', true) else item end;
    evidence_status := case lower(coalesce(item->>'evidenceStatus', item->>'status', ''))
      when 'known' then 'known'
      when 'researched' then 'researched'
      when 'inferred' then 'inferred'
      else case when item = '{}'::jsonb then 'insufficient' else 'unknown' end
    end;
    confidence := case lower(coalesce(item->>'confidence', ''))
      when 'high' then 'high'
      when 'medium' then 'medium'
      else 'low'
    end;
    source_type := coalesce(item->>'sourceType', item->>'source_type', item->>'provider', 'unknown');
    source_url := coalesce(item->>'url', item->>'sourceUrl');
    source_snippet := coalesce(item->>'snippet', item->>'excerpt', item->>'description', item->>'text');
    observed_at := case when coalesce(item->>'observedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}' then (item->>'observedAt')::timestamptz else null end;
    hash := md5(snapshot::text || coalesce(source_url, '') || coalesce(source_snippet, ''));
    insert into public.sales_os_evidence_records (
      tenant_id, product_id, subject_type, subject_id, source_reference,
      source_type, source_url, source_snippet, evidence_status, confidence,
      explanation, snapshot, observed_at, content_hash, created_by
    ) values (
      new.tenant_id, new.product_id, subject_type, new.id,
      coalesce(item->>'sourceId', item->>'source_id'), source_type, source_url,
      source_snippet, evidence_status, confidence,
      case when evidence_status = 'insufficient'
        then 'Insufficient evidence: no persisted source evidence is available for this recommendation.'
        else 'Evidence captured from the persisted source snapshot; qualitative claims require review against the linked source.'
      end,
      snapshot, observed_at, hash, coalesce(new.created_by, 'system')
    ) on conflict do nothing;
  end loop;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_os_product_profiles', 'sales_os_icps', 'sales_os_audiences',
    'sales_os_signals', 'sales_os_accounts', 'sales_os_contacts',
    'sales_os_intent_scores', 'sales_os_opportunities',
    'sales_os_outreach_decisions', 'sales_os_engagements'
  ] loop
    execute format('drop trigger if exists sales_os_capture_evidence_%s on public.%I', table_name, table_name);
    execute format('create trigger sales_os_capture_evidence_%s after insert or update on public.%I for each row execute function public.sales_os_capture_evidence_snapshot()', table_name, table_name);
  end loop;
end $$;

-- Invoke the same append-only capture path for existing records without changing
-- their values. Content hashes make this backfill safe to rerun.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_os_product_profiles', 'sales_os_icps', 'sales_os_audiences',
    'sales_os_signals', 'sales_os_accounts', 'sales_os_contacts',
    'sales_os_intent_scores', 'sales_os_opportunities',
    'sales_os_outreach_decisions', 'sales_os_engagements'
  ] loop
    execute format('update public.%I set id = id where tenant_id = ''sales_os''', table_name);
  end loop;
end $$;

comment on table public.sales_os_evidence_records is
  'Append-only evidence snapshots and explicit evidence gaps for material Sales OS recommendations.';
comment on column public.sales_os_evidence_records.explanation is
  'Deterministic explanation grounded in the persisted snapshot; it is not an unsupported AI assertion.';
