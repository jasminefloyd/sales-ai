import { describe, expect, it } from 'vitest';

import { evaluatePreSend } from './guards';

const validInput = {
  productStatus: 'active',
  opportunityStatus: 'approved',
  engagementStatus: 'approved',
  contactEmail: 'jordan@example.com',
  emailVerificationStatus: 'valid',
  suppressionRecords: [],
  productId: 'product-1',
  priorEngagements: [],
  sendingLimitReached: false,
  budgetAllowed: true,
  gmailEnabled: true,
};

describe('pre-send guards', () => {
  it('allows only a fully eligible approved send', () => {
    expect(evaluatePreSend(validInput)).toEqual({ allowed: true, reason: null });
  });

  it('blocks suppression before any provider call', () => {
    expect(
      evaluatePreSend({
        ...validInput,
        suppressionRecords: [
          {
            tenant_id: 'sales_os',
            product_id: 'product-1',
            channel: 'email',
            identifier: 'JORDAN@EXAMPLE.COM',
            active: true,
          },
        ],
      }),
    ).toEqual({ allowed: false, reason: 'contact_suppressed' });
  });

  it('blocks invalid email without creating send-ready behavior', () => {
    expect(
      evaluatePreSend({ ...validInput, emailVerificationStatus: 'invalid' }),
    ).toEqual({
      allowed: false,
      reason: 'email_not_verified',
    });
  });
});
