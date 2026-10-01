import { describe, expect, it } from 'vitest';

import { buildProductSourceInsert } from './sourceService';

describe('product source persistence contract', () => {
  it('persists parsed file content and fields', () => {
    expect(
      buildProductSourceInsert(
        'product-1',
        {
          sourceType: 'file',
          fileName: 'product.md',
          mimeType: 'text/markdown',
          content: '# Product',
          parsedFields: { name: 'Product' },
        },
        'user-1',
      ),
    ).toMatchObject({
      tenant_id: 'sales_os',
      product_id: 'product-1',
      source_type: 'file',
      file_name: 'product.md',
      parse_status: 'parsed',
      parsed_fields: { name: 'Product' },
    });
  });

  it('rejects empty source content and unnamed files', () => {
    expect(() =>
      buildProductSourceInsert(
        'product-1',
        { sourceType: 'file', content: ' ', parsedFields: {} },
        'user-1',
      ),
    ).toThrow('Product source content is required.');
    expect(() =>
      buildProductSourceInsert(
        'product-1',
        { sourceType: 'file', fileName: ' ', content: 'content', parsedFields: {} },
        'user-1',
      ),
    ).toThrow('Imported files must include a file name.');
  });
});
