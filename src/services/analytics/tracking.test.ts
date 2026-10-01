import { describe, expect, it } from 'vitest';

import { buildServerEventInsert } from './tracking';

describe('first-party analytics tracking contracts', () => {
  it('preserves anonymous identity and Sales OS attribution on server events', () => {
    expect(
      buildServerEventInsert({
        productId: '00000000-0000-0000-0000-000000000001',
        eventName: 'user_signed_up',
        anonymousId: 'anon-1',
        sessionId: 'session-1',
        salesAttributionId: 'sales-attr-1',
        source: 'server',
        idempotencyKey: 'signup-1',
      }),
    ).toMatchObject({
      anonymous_id: 'anon-1',
      session_id: 'session-1',
      sales_attribution_id: 'sales-attr-1',
      idempotency_key: 'signup-1',
    });
  });

  it('requires an idempotency key for authoritative server events', () => {
    const event = buildServerEventInsert({
      productId: '00000000-0000-0000-0000-000000000001',
      eventName: 'pass_purchased',
      source: 'stripe',
      idempotencyKey: 'stripe:event-1',
    });
    expect(event.idempotency_key).toBe('stripe:event-1');
    expect(event.is_internal).toBe(false);
  });
});
