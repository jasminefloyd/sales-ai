-- Preserve document-backed evidence returned by every reasoning provider.

create or replace function public.sales_os_capture_evidence_snapshot()
returns trigger language plpgsql as $$
declare
  row_data jsonb := to_jsonb(new);
  evidence jsonb := '[]'::jsonb;
  item jsonb;
  subject_type text;
  evidence_status text;
  confidence text;
  source_type text;
  source_url text;
  source_reference text;
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
  evidence := coalesce(row_data->'source_evidence', row_data->'supporting_evidence', row_data->'evidence', row_data->'evidence_context', '[]'::jsonb);
  if jsonb_typeof(evidence) <> 'array' then evidence := '[]'::jsonb; end if;
  if jsonb_array_length(evidence) = 0 then evidence := jsonb_build_array('{}'::jsonb); end if;
  for item in select value from jsonb_array_elements(evidence) loop
    snapshot := case when item = '{}'::jsonb then jsonb_build_object('missingEvidence', true) else item end;
    evidence_status := case lower(coalesce(item->>'evidenceStatus', item->>'evidence_status', item->>'status', ''))
      when 'known' then 'known' when 'researched' then 'researched' when 'inferred' then 'inferred' when 'insufficient' then 'insufficient'
      else case when item = '{}'::jsonb then 'insufficient' else 'known' end end;
    confidence := case lower(coalesce(item->>'confidence', '')) when 'high' then 'high' when 'medium' then 'medium' else case when item = '{}'::jsonb then 'low' else 'medium' end end;
    source_type := coalesce(item->>'sourceType', item->>'source_type', item->>'provider', item->>'type', 'unknown');
    source_url := coalesce(item->>'url', item->>'sourceUrl', item->>'source_url');
    source_reference := coalesce(item->>'sourceId', item->>'source_id', item->>'sourceReference', item->>'source_reference', item->>'source');
    source_snippet := coalesce(item->>'snippet', item->>'excerpt', item->>'description', item->>'text', nullif(concat_ws(' · ', item->>'relevance', item->>'credibility'), ''));
    observed_at := case when coalesce(item->>'observedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}' then (item->>'observedAt')::timestamptz else null end;
    hash := md5(snapshot::text || coalesce(source_url, '') || coalesce(source_reference, '') || coalesce(source_snippet, ''));
    insert into public.sales_os_evidence_records (tenant_id, product_id, subject_type, subject_id, source_reference, source_type, source_url, source_snippet, evidence_status, confidence, explanation, snapshot, observed_at, content_hash, created_by)
    values (new.tenant_id, new.product_id, subject_type, new.id, source_reference, source_type, source_url, source_snippet, evidence_status, confidence,
      case when evidence_status = 'insufficient' then 'Insufficient evidence: no persisted source evidence is available for this recommendation.' else 'Evidence captured from the persisted source snapshot; qualitative claims require review against the linked source.' end,
      snapshot, observed_at, hash, coalesce(new.created_by, 'system')) on conflict do nothing;
  end loop;
  return new;
end;
$$;

update public.sales_os_evidence_records
set source_reference = coalesce(source_reference, snapshot->>'source'),
    source_type = case when source_type = 'unknown' then coalesce(snapshot->>'type', source_type) else source_type end,
    source_snippet = coalesce(source_snippet, nullif(concat_ws(' · ', snapshot->>'relevance', snapshot->>'credibility'), '')),
    evidence_status = case when snapshot->>'source' is null then evidence_status else 'known' end,
    confidence = case when snapshot->>'source' is null then confidence else 'medium' end
where tenant_id = 'sales_os' and (snapshot ? 'source' or snapshot ? 'relevance' or snapshot ? 'credibility');
