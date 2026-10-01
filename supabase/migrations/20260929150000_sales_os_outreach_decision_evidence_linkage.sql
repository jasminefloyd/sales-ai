-- Preserve the evidence chain from an approved audience into its
-- downstream outreach decision. Outreach decisions are derived artifacts;
-- they must not appear unsupported when their parent audience is sourced.

create or replace function public.sales_os_capture_outreach_decision_evidence()
returns trigger
language plpgsql
as $$
declare
  source_record record;
begin
  if new.audience_id is null then
    return new;
  end if;

  for source_record in
    select id, source_reference, source_type, source_url, source_snippet,
           evidence_status, confidence, explanation, snapshot, observed_at
    from public.sales_os_evidence_records
    where tenant_id = new.tenant_id
      and product_id = new.product_id
      and subject_type = 'audience'
      and subject_id = new.audience_id
      and (
        nullif(trim(source_reference), '') is not null
        or nullif(trim(source_url), '') is not null
        or nullif(trim(source_snippet), '') is not null
      )
  loop
    insert into public.sales_os_evidence_records (
      tenant_id, product_id, subject_type, subject_id, source_reference,
      source_type, source_url, source_snippet, evidence_status, confidence,
      explanation, snapshot, observed_at, content_hash, created_by
    ) values (
      new.tenant_id,
      new.product_id,
      'outreach_decision',
      new.id,
      source_record.source_reference,
      source_record.source_type,
      source_record.source_url,
      source_record.source_snippet,
      source_record.evidence_status,
      source_record.confidence,
      'Evidence inherited from the linked audience source record. The outreach recommendation is derived from the approved audience strategy.',
      jsonb_build_object(
        'derivedFromEvidenceRecordId', source_record.id,
        'audienceId', new.audience_id,
        'sourceSnapshot', source_record.snapshot
      ),
      source_record.observed_at,
      md5('outreach-decision-audience-evidence:' || source_record.id::text),
      coalesce(new.updated_by, new.created_by, 'system')
    ) on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists sales_os_link_outreach_decision_evidence
  on public.sales_os_outreach_decisions;
create trigger sales_os_link_outreach_decision_evidence
after insert or update on public.sales_os_outreach_decisions
for each row execute function public.sales_os_capture_outreach_decision_evidence();

-- Backfill the linkage for decisions created before this trigger existed.
insert into public.sales_os_evidence_records (
  tenant_id, product_id, subject_type, subject_id, source_reference,
  source_type, source_url, source_snippet, evidence_status, confidence,
  explanation, snapshot, observed_at, content_hash, created_by
)
select
  decision.tenant_id,
  decision.product_id,
  'outreach_decision',
  decision.id,
  evidence.source_reference,
  evidence.source_type,
  evidence.source_url,
  evidence.source_snippet,
  evidence.evidence_status,
  evidence.confidence,
  'Evidence inherited from the linked audience source record. The outreach recommendation is derived from the approved audience strategy.',
  jsonb_build_object(
    'derivedFromEvidenceRecordId', evidence.id,
    'audienceId', decision.audience_id,
    'sourceSnapshot', evidence.snapshot
  ),
  evidence.observed_at,
  md5('outreach-decision-audience-evidence:' || evidence.id::text),
  coalesce(decision.updated_by, decision.created_by, 'system')
from public.sales_os_outreach_decisions decision
join public.sales_os_evidence_records evidence
  on evidence.tenant_id = decision.tenant_id
 and evidence.product_id = decision.product_id
 and evidence.subject_type = 'audience'
 and evidence.subject_id = decision.audience_id
where (
  nullif(trim(evidence.source_reference), '') is not null
  or nullif(trim(evidence.source_url), '') is not null
  or nullif(trim(evidence.source_snippet), '') is not null
)
on conflict do nothing;
