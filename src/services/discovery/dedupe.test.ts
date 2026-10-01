import { describe, expect, it } from 'vitest';

import {
  findContactForProduct,
  hasDuplicateContact,
  hasDuplicateOpportunity,
} from './dedupe';

const contacts = [
  {
    id: 'contact-a',
    tenant_id: 'sales_os',
    product_id: 'product-a',
    professional_email: 'person@example.com',
  },
  {
    id: 'contact-b',
    tenant_id: 'sales_os',
    product_id: 'product-b',
    professional_email: 'person@example.com',
  },
];

describe('product-scoped discovery dedupe', () => {
  it('permits the same external contact independently for two products', () => {
    expect(hasDuplicateContact(contacts, 'product-a', 'PERSON@example.com')).toBe(true);
    expect(hasDuplicateContact(contacts, 'product-b', 'PERSON@example.com')).toBe(true);
    expect(findContactForProduct(contacts, 'product-a', 'contact-b')).toBeUndefined();
    expect(findContactForProduct(contacts, 'product-b', 'contact-b')?.id).toBe(
      'contact-b',
    );
  });

  it('deduplicates opportunities only within one product', () => {
    const opportunities = [
      {
        id: 'opportunity-a',
        tenant_id: 'sales_os',
        product_id: 'product-a',
        dedupe_key: 'source:123',
      },
    ];
    expect(hasDuplicateOpportunity(opportunities, 'product-a', 'source:123')).toBe(
      true,
    );
    expect(hasDuplicateOpportunity(opportunities, 'product-b', 'source:123')).toBe(
      false,
    );
  });
});
