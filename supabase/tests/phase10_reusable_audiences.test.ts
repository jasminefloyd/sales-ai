import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../migrations/20260929100000_sales_os_phase_10_reusable_audiences.sql',
    import.meta.url,
  ),
  'utf8',
);
const repairMigration = readFileSync(
  new URL(
    '../migrations/20260929110000_sales_os_phase_10_workflow_stage_repair.sql',
    import.meta.url,
  ),
  'utf8',
);
const refreshFunction = readFileSync(
  new URL('../functions/sales_os-refresh-audience/index.ts', import.meta.url),
  'utf8',
);
const worker = readFileSync(
  new URL('../functions/_shared/workerAnalysis.ts', import.meta.url),
  'utf8',
);

describe('phase 10 reusable audience contract', () => {
  it('defines versioned refresh and membership history', () => {
    expect(migration).toContain('sales_os_audience_refresh_runs');
    expect(migration).toContain('sales_os_audience_membership_changes');
    expect(migration).toContain("'audience_refresh'");
    expect(migration).toContain('rule_object_check');
    expect(migration).toContain("'audience', 'find', 'engage', 'learn', 'diagnostics'");
    expect(repairMigration).toContain("when 'audience_refresh' then 'audience'");
  });
  it('wires preview, deterministic operators, worker refresh, and changes', () => {
    expect(refreshFunction).toContain("action?: 'preview' | 'refresh'");
    expect(refreshFunction).toContain("operator === 'contains'");
    expect(worker).toContain('executeAudienceRefreshForWorker');
    expect(worker).toContain('sales_os_audience_membership_changes');
    expect(worker).toContain('change_type: changeType');
  });
});
