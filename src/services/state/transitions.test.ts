import { describe, expect, it } from 'vitest';

import { assertValidStateTransition, InvalidStateTransitionError } from './transitions';

describe('Sales OS state transitions', () => {
  it('allows the canonical product flow', () => {
    expect(() =>
      assertValidStateTransition('product', 'draft', 'analyzing'),
    ).not.toThrow();
    expect(() =>
      assertValidStateTransition('product', 'analyzing', 'audience_review'),
    ).not.toThrow();
    expect(() =>
      assertValidStateTransition('product', 'audience_review', 'active'),
    ).not.toThrow();
  });

  it('rejects arbitrary state jumps', () => {
    expect(() =>
      assertValidStateTransition('opportunity', 'discovered', 'converted'),
    ).toThrow(InvalidStateTransitionError);
  });
});
