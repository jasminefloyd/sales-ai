import { describe, expect, it } from 'vitest';

import { isSuppressed } from './suppression';

const record = {
  tenant_id: 'sales_os',
  product_id: 'product-a',
  channel: 'email',
  identifier: 'Person@Example.com',
  active: true,
};

describe('product-scoped suppression', () => {
  it('suppresses a matching identifier only for the same product', () => {
    expect(isSuppressed([record], 'product-a', 'email', 'person@example.com')).toBe(
      true,
    );
    expect(isSuppressed([record], 'product-b', 'email', 'person@example.com')).toBe(
      false,
    );
  });
});
