import { describe, expect, it } from 'vitest';

import {
  assertFixedCommunityIdentity,
  buildCommunityEngagementInsert,
} from './community';

describe('community engagement guardrails', () => {
  it('only accepts the configured branded identity within scope', () => {
    const account = {
      id: 'account-1',
      product_id: 'product-1',
      platform: 'reddit' as const,
      external_account_id: 'brand-account',
      display_label: 'Brand Community Account',
      enabled: true,
    };

    expect(() =>
      assertFixedCommunityIdentity(account, {
        productId: 'product-1',
        platform: 'reddit',
      }),
    ).not.toThrow();
    expect(() =>
      assertFixedCommunityIdentity(account, {
        productId: 'product-1',
        platform: 'reddit',
        requestedAccountId: 'different-account',
      }),
    ).toThrow('Posting identity must come from fixed configuration.');
  });

  it('persists a community engagement with its fixed channel account', () => {
    const insert = buildCommunityEngagementInsert({
      productId: 'product-1',
      opportunityId: 'opportunity-1',
      accountId: 'account-1',
      draftContent: 'Relevant response with transparent affiliation.',
      messageAngle: 'Observed problem',
      cta: 'Learn more',
      actor: 'user-1',
    });

    expect(insert.channel).toBe('community');
    expect(insert.status).toBe('awaiting_approval');
    expect(insert.channel_account_id).toBe('account-1');
    expect(insert.action_type).toBe('respond');
  });
});
