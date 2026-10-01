export type WorkflowLineageRelation =
  | 'source_to_profile'
  | 'profile_to_icp'
  | 'icp_to_audience'
  | 'audience_to_outreach_decision'
  | 'outreach_decision_to_copy';

export function buildLineageInsert(input: {
  productId: string;
  relationType: WorkflowLineageRelation;
  sourceId?: string | null;
  profileId?: string | null;
  icpId?: string | null;
  audienceId?: string | null;
  outreachDecisionId?: string | null;
  engagementId?: string | null;
  metadata?: Record<string, unknown>;
  actor?: string | null;
}) {
  return {
    tenant_id: 'sales_os',
    product_id: input.productId,
    source_id: input.sourceId ?? null,
    profile_id: input.profileId ?? null,
    icp_id: input.icpId ?? null,
    audience_id: input.audienceId ?? null,
    outreach_decision_id: input.outreachDecisionId ?? null,
    engagement_id: input.engagementId ?? null,
    relation_type: input.relationType,
    metadata: input.metadata ?? {},
    created_by: input.actor ?? null,
  };
}
