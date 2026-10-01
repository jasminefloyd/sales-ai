import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrations = resolve(process.cwd(), 'supabase/migrations');
const canonical = readFileSync(
  resolve(migrations, '20260922001000_sales_os_canonical_state.sql'),
  'utf8',
);
const guardrails = readFileSync(
  resolve(migrations, '20260922002000_sales_os_provider_guardrails.sql'),
  'utf8',
);

describe('Phase 14 hardening contracts', () => {
  it('keeps tenant and product scope on core tables and policies', () => {
    expect(canonical).toContain('tenant_id text not null');
    expect(canonical).toContain('foreign key (tenant_id, product_id)');
    expect(canonical).toContain("tenant_id = ''sales_os''");
    expect(guardrails).toContain("tenant_id = 'sales_os'");
  });

  it('requires approval status for state-changing engagement paths', () => {
    expect(canonical).toContain("status in ('drafted', 'awaiting_approval'");
    expect(canonical).toContain("p_old_status = 'awaiting_approval'");
    expect(canonical).toContain(
      "p_new_status in ('approved', 'rejected', 'cancelled')",
    );
  });

  it('contains budget reservation and concurrency protection contracts', () => {
    expect(guardrails).toContain('sales_os_budget_reservations');
    expect(guardrails).toContain('pg_advisory_xact_lock');
    expect(guardrails).toContain('requested_cost');
  });

  it('defines non-secret AI provenance columns for provider runs', () => {
    const metadataMigration = readFileSync(
      resolve(migrations, '20260922008000_sales_os_ai_run_metadata.sql'),
      'utf8',
    );
    expect(metadataMigration).toContain('prompt_version');
    expect(metadataMigration).toContain('model_identifier');
    expect(metadataMigration).not.toContain('api_key');
    expect(metadataMigration).not.toContain('api_key');
  });

  it('defines the append-only first-party admin analytics stream', () => {
    const analyticsMigration = readFileSync(
      resolve(migrations, '20260922009000_sales_os_admin_analytics.sql'),
      'utf8',
    );
    expect(analyticsMigration).toContain('create table public.sales_os_admin_events');
    expect(analyticsMigration).toContain('sales_os_admin_events_immutable');
    expect(analyticsMigration).toContain('sales_os_admin_events_public_track');
    expect(analyticsMigration).toContain('sales_attribution_id');
    expect(analyticsMigration).toContain('idempotency_key');
  });
});
