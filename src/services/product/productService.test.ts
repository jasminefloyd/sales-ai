import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildProductAnalysisJobInsert,
  buildProductInsert,
  chooseAvailableSlug,
  createProduct,
} from './productService';

const input = {
  name: 'RunScene AI',
  websiteUrl: 'https://runscene.example.com',
  descriptionInput: '',
  pricingBusinessModel: 'Subscription',
  primaryObjective: 'Acquire customers',
  geographicConstraints: 'US',
  knownAudiences: 'Actors',
  additionalContext: 'Human supervised.',
  monthlySpendCap: 100,
  perRunSpendCap: 10,
  currency: 'USD',
};

describe('product initialization contracts', () => {
  it('builds a tenant-scoped product insert without fake operational data', () => {
    expect(buildProductInsert(input, 'user-1')).toMatchObject({
      tenant_id: 'sales_os',
      name: 'RunScene AI',
      slug: 'runscene-ai',
      created_by: 'user-1',
    });
  });

  it('creates a queued product-analysis job input', () => {
    expect(buildProductAnalysisJobInsert('product-1', input, 'user-1')).toMatchObject({
      tenant_id: 'sales_os',
      product_id: 'product-1',
      job_type: 'product_analysis',
      status: 'queued',
    });
  });

  it('allocates a readable collision-safe slug', () => {
    expect(chooseAvailableSlug('runscene-ai', ['runscene-ai'])).toBe('runscene-ai-2');
    expect(chooseAvailableSlug('runscene-ai', ['runscene-ai', 'runscene-ai-2'])).toBe(
      'runscene-ai-3',
    );
    expect(chooseAvailableSlug('runscene-ai', [])).toBe('runscene-ai');
  });

  it('selects an available slug before inserting a duplicate product name', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const client = {
      from(table: string) {
        if (table === 'sales_os_products') {
          return {
            select() {
              return {
                eq() {
                  return {
                    like: async () => ({
                      data: [{ slug: 'runscene-ai' }],
                      error: null,
                    }),
                  };
                },
              };
            },
            insert(row: Record<string, unknown>) {
              inserted.push(row);
              return {
                select() {
                  return {
                    single: async () => ({
                      data: { ...row, id: 'product-2' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === 'sales_os_jobs') {
          return {
            upsert() {
              return {
                select() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: 'job-2' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    await createProduct(client, input, 'user-1');

    expect(inserted[0]?.slug).toBe('runscene-ai-2');
  });
});
