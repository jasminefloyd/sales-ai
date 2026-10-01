import { describe, expect, it } from 'vitest';

import {
  buildJobIdempotencyKey,
  buildJobInsert,
  retryDelayMs,
  shouldRetryJob,
} from './jobService';

describe('background job contracts', () => {
  it('persists a deterministic idempotency key before execution', () => {
    const key = buildJobIdempotencyKey({
      productId: 'product-1',
      jobType: 'find',
      scope: 'audience-1',
    });
    const job = buildJobInsert({
      productId: 'product-1',
      jobType: 'find',
      payload: {},
      actor: 'user-1',
      idempotencyKey: key,
    });
    expect(job.status).toBe('queued');
    expect(job.idempotency_key).toBe('sales_os:product-1:find:audience-1');
  });

  it('retries only retryable internal failures and never ambiguous external engagement', () => {
    expect(
      shouldRetryJob({
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        externalEngagement: false,
      }),
    ).toBe(true);
    expect(
      shouldRetryJob({
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        externalEngagement: true,
      }),
    ).toBe(false);
    expect(
      shouldRetryJob({
        attempt: 3,
        maxAttempts: 3,
        retryable: true,
        externalEngagement: false,
      }),
    ).toBe(false);
    expect(retryDelayMs(3)).toBe(120_000);
  });
});
