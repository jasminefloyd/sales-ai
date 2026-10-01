import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase/browser', () => ({ supabaseBrowserClient: {} }));
import { buildActivationPreview } from './activationService';

describe('activation readiness preview', () => {
  it('only allows ready, clear, permitted members', () => {
    const result = buildActivationPreview([
      {
        id: 'ready',
        account_id: 'a1',
        contact_id: null,
        external_entity_key: null,
        status: 'ready',
        quality_state: 'ready',
        suppression_state: 'clear',
        consent_state: 'permitted',
      },
      {
        id: 'blocked',
        account_id: null,
        contact_id: 'c1',
        external_entity_key: null,
        status: 'stale',
        quality_state: 'stale',
        suppression_state: 'suppressed',
        consent_state: 'revoked',
      },
    ]);
    expect(result.eligible.map((member) => member.id)).toEqual(['ready']);
    expect(result.blocked[0].reasons).toEqual([
      'status:stale',
      'quality:stale',
      'suppressed_or_unchecked',
      'consent_blocked',
    ]);
  });
});
