import { describe, expect, it } from 'vitest';

import { buildLineageInsert } from './lineage';

describe('buildLineageInsert', () => {
  it('creates a product-scoped source-to-profile link', () => {
    expect(
      buildLineageInsert({
        productId: 'p1',
        sourceId: 's1',
        profileId: 'profile-1',
        relationType: 'source_to_profile',
        actor: 'user-1',
      }),
    ).toMatchObject({
      product_id: 'p1',
      source_id: 's1',
      profile_id: 'profile-1',
      relation_type: 'source_to_profile',
    });
  });
});
