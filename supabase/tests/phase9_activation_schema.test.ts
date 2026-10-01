import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../migrations/20260929090000_sales_os_phase_09_activation.sql',
    import.meta.url,
  ),
  'utf8',
);
const worker = readFileSync(
  new URL('../functions/_shared/workerAnalysis.ts', import.meta.url),
  'utf8',
);
const activation = readFileSync(
  new URL('../functions/sales_os-activation/index.ts', import.meta.url),
  'utf8',
);

describe('phase 9 activation contract', () => {
  it('defines secure destinations and activation sync fields', () => {
    expect(migration).toContain('sales_os_activation_destinations');
    expect(migration).toContain('secret_ref');
    expect(migration).toContain('field_mapping');
    expect(migration).toContain("'activation_sync'");
    expect(migration).toContain('sales_os_activation_destination_fk');
  });

  it('wires approval, readiness gates, reconciliation, and audit events', () => {
    expect(activation).toContain("action === 'approve'");
    expect(worker).toContain('sales_os_member_activation_ready');
    expect(worker).toContain("status: 'removed'");
    expect(worker).toContain('activation_sync_completed');
    expect(worker).toContain('response.status === 429');
  });
});
