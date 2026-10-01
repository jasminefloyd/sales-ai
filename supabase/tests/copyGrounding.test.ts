import { describe, expect, it } from 'vitest';

import {
  assertRecipientSafeDraft,
  buildCopyGrounding,
} from '../functions/_shared/copyGrounding';

describe('first-touch copy grounding', () => {
  const profile = {
    core_capabilities: ['MarketPulse competitor monitoring'],
    primary_use_cases: ['Local market research'],
  };

  it('requires the real product to be introduced', () => {
    expect(() =>
      assertRecipientSafeDraft(
        'I noticed your MarketPulse alerts are helping your team.',
        'LMIA',
        profile,
        'email',
      ),
    ).toThrow('did not introduce the product by name');
  });

  it('rejects unsupported ownership of a product capability generically', () => {
    expect(() =>
      assertRecipientSafeDraft(
        'LMIA helps local operators. Your MarketPulse alerts are a great example.',
        'LMIA',
        profile,
        'email',
      ),
    ).toThrow('already uses an internal product capability');
  });

  it('provides product and recipient grounding to the generation prompt', () => {
    const grounding = buildCopyGrounding(
      { name: 'LMIA' },
      profile,
      { name: 'Local operators' },
      { full_name: 'Alex Rivera', title: 'Owner', email_verification_status: 'valid' },
      'email',
    );
    expect(grounding.productName).toBe('LMIA');
    expect(grounding.approvedCapabilities).toEqual(profile.core_capabilities);
    expect(grounding.verifiedRecipient?.fullName).toBe('Alex Rivera');
    expect(grounding.firstTouchRules.join(' ')).toContain('internal feature');
  });
});
