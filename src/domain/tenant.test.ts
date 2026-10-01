import { describe, expect, it } from 'vitest';

import { assertSalesOsTenant } from './tenant';

describe('Sales OS tenant guard', () => {
  it('accepts only the mandated sales_os tenant', () => {
    expect(() => assertSalesOsTenant('sales_os')).not.toThrow();
    expect(() => assertSalesOsTenant('other_app')).toThrow();
  });
});
