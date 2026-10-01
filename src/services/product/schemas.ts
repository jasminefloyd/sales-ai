import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));

export const ProductCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required.'),
    websiteUrl: optionalUrl,
    descriptionInput: z.string().trim().optional().default(''),
    pricingBusinessModel: z.string().trim().optional().default(''),
    primaryObjective: z.string().trim().min(1, 'Primary conversion goal is required.'),
    geographicConstraints: z.string().trim().optional().default(''),
    knownAudiences: z.string().trim().optional().default(''),
    additionalContext: z.string().trim().optional().default(''),
    monthlySpendCap: z.number().nonnegative().nullable().optional().default(null),
    perRunSpendCap: z.number().nonnegative().nullable().optional().default(null),
    currency: z.string().trim().length(3).default('USD'),
  })
  .superRefine((input, context) => {
    if (!input.websiteUrl && !input.descriptionInput) {
      context.addIssue({
        code: 'custom',
        path: ['descriptionInput'],
        message: 'Provide a product URL or enough product description to analyze.',
      });
    }
  });

export const ProductSalesProfileSchema = z.object({
  product: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  problemsSolved: z.array(z.string()),
  coreCapabilities: z.array(z.string()),
  primaryUseCases: z.array(z.string()),
  pricingBusinessModel: z.record(z.string(), z.unknown()),
  conversionEvent: z.record(z.string(), z.unknown()),
  purchaseFriction: z.string(),
  competitiveAlternatives: z.array(z.string()),
  purchaseTriggers: z.array(z.string()),
  positioningValueProps: z.array(z.string()),
  sourceEvidence: z.array(
    z.object({
      url: z.string().url().optional(),
      snippet: z.string().min(1),
      sourceType: z.string().min(1),
    }),
  ),
});

export type ProductCreateInput = z.infer<typeof ProductCreateInputSchema>;
export type ProductSalesProfile = z.infer<typeof ProductSalesProfileSchema>;
