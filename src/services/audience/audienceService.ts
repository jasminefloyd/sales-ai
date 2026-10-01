import { SALES_OS_TENANT_ID } from '../../domain/tenant';
import { scoreEvidence, type EvidenceInputs } from '../evidence/scoring';

export type AudienceProposalInput = {
  productId: string;
  name: string;
  buyerType: 'individual' | 'organization';
  problemUseCaseFit: string;
  buyingBehavior: Record<string, unknown>;
  purchaseTriggers: string[];
  relevantTerminology: string[];
  supportingEvidence: Array<{ url?: string; snippet: string; sourceType: string }>;
  evidenceInputs: EvidenceInputs;
  aiFitAssessment: string;
  priority: 'low' | 'medium' | 'high';
  routes: Array<{
    routeType: 'social' | 'direct';
    rationale: string;
    searchStrategy: Record<string, unknown>;
  }>;
  actor: string;
};

export function buildAudienceProposal(input: AudienceProposalInput) {
  const evidence = scoreEvidence(input.evidenceInputs);
  const audienceId = crypto.randomUUID();
  return {
    audience: {
      id: audienceId,
      tenant_id: SALES_OS_TENANT_ID,
      product_id: input.productId,
      name: input.name,
      buyer_type: input.buyerType,
      problem_use_case_fit: input.problemUseCaseFit,
      buying_behavior: input.buyingBehavior,
      purchase_triggers: input.purchaseTriggers,
      relevant_terminology: input.relevantTerminology,
      supporting_evidence: input.supportingEvidence,
      evidence_score: evidence.score,
      evidence_score_detail: evidence.detail,
      ai_fit_assessment: input.aiFitAssessment,
      priority: input.priority,
      status: 'proposed',
      created_by: input.actor,
      updated_by: input.actor,
    },
    routes: input.routes.map((route) => ({
      id: crypto.randomUUID(),
      tenant_id: SALES_OS_TENANT_ID,
      product_id: input.productId,
      audience_id: audienceId,
      route_type: route.routeType,
      status: 'proposed',
      rationale: route.rationale,
      search_strategy: route.searchStrategy,
      created_by: input.actor,
      updated_by: input.actor,
    })),
  };
}
