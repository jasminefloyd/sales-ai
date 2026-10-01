import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worker = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/workerAnalysis.ts'),
  'utf8',
);

describe('engagement draft contract', () => {
  it('requires one channel-specific draft without wrapper labels or quotes', () => {
    expect(worker).toContain('exactly one message for the requested channel');
    expect(worker).toContain('surrounding quotation marks');
  });
});
