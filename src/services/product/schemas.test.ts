import { describe, expect, it } from 'vitest';

import { ProductCreateInputSchema, ProductSalesProfileSchema } from './schemas';

describe('Phase 4 structured contracts', () => {
  it('requires either a URL or enough product description', () => {
    expect(() => ProductCreateInputSchema.parse({ name: 'Product' })).toThrow();
    expect(
      ProductCreateInputSchema.parse({
        name: 'Product',
        descriptionInput: 'A useful product.',
        primaryObjective: 'signup',
      }),
    ).toMatchObject({ name: 'Product' });
  });

  it('rejects profiles that do not match the canonical structured schema', () => {
    expect(() =>
      ProductSalesProfileSchema.parse({ category: 'missing fields' }),
    ).toThrow();
  });
});
