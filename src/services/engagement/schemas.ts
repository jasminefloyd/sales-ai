import { z } from 'zod';

export const EngagementDraftSchema = z.object({
  messageAngle: z.string().min(1),
  cta: z.string().min(1),
  draftContent: z.string().min(1),
});

export type EngagementDraft = z.infer<typeof EngagementDraftSchema>;

export function validateEngagementDraft(input: unknown): EngagementDraft {
  return EngagementDraftSchema.parse(input);
}
