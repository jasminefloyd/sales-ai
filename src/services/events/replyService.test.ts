import { describe, expect, it } from 'vitest';

import { buildEventInsert } from './eventService';

describe('event ingestion contracts', () => {
  it('uses an external message id as the idempotency boundary for replies', () => {
    const event = buildEventInsert({
      productId: 'product-1',
      eventType: 'response_received',
      idempotencyKey: 'response-received:message-1',
      externalEventId: 'message-1',
      dimensions: { channel: 'email' },
      createdBy: 'system',
    });
    expect(event.idempotency_key).toBe('response-received:message-1');
    expect(event.external_event_id).toBe('message-1');
  });
});
