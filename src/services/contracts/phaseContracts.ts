import { z } from 'zod';

export const ProvenanceSchema = z.object({
  value: z.unknown(),
  source: z.string().nullable().optional(),
  sourceType: z.enum(['user', 'website', 'provider', 'research', 'ai', 'unknown']),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceStatus: z.enum(['known', 'researched', 'inferred', 'unknown']),
});

export const IcpSchema = z.object({
  name: z.string().min(1),
  buyerType: z.enum(['individual', 'organization']),
  summary: z.string().min(1),
  coreProblem: z.string().min(1),
  whyProductFits: z.string().min(1),
  purchaseTrigger: z.string().min(1),
  currentAlternative: z.string().min(1),
  buyingMotivation: z.string().min(1),
  purchaseFriction: z.string().min(1),
  evidence: z.array(z.unknown()).min(1),
  evidenceScore: z.enum(['low', 'medium', 'high']),
  aiFitAssessment: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']),
  status: z.enum(['proposed', 'approved', 'active', 'paused', 'rejected']),
  isPrimary: z.boolean(),
});

export const AudienceChildSchema = z.object({
  icpId: z.string().uuid(),
  icpVersion: z.number().int().positive(),
  audienceVersion: z.number().int().positive(),
  name: z.string().min(1),
  summary: z.string().min(1),
  routeTypes: z.array(z.enum(['social', 'direct'])).min(1),
  reachabilityEvidence: z.array(z.unknown()).min(1),
  status: z.enum(['proposed', 'approved', 'active', 'paused', 'rejected']),
});

export const EngagementProposalSchema = z.object({
  opportunityId: z.string().uuid(),
  channel: z.enum(['email', 'reddit', 'community', 'professional_social', 'manual']),
  objective: z.string().min(1),
  evidenceContext: z.array(z.unknown()),
  whyEngage: z.string().min(1),
  messageAngle: z.string().min(1),
  cta: z.string().min(1),
  message: z.string().min(1),
  followUpStrategy: z.record(z.string(), z.unknown()),
  riskSensitivity: z.string().min(1),
  suppressionCheck: z.record(z.string(), z.unknown()),
});

export type IcpContract = z.infer<typeof IcpSchema>;
export type AudienceChildContract = z.infer<typeof AudienceChildSchema>;
export type EngagementProposalContract = z.infer<typeof EngagementProposalSchema>;
