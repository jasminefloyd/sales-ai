import { describe, expect, it } from 'vitest';

import {
  canAutoLink,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  resolveAccountMatch,
  resolveContactMatch,
} from './identityService';

describe('identity resolution', () => {
  it('normalizes deterministic identifiers', () => {
    expect(normalizeEmail(' Person@Example.com ')).toBe('person@example.com');
    expect(normalizePhone('+1 (212) 555-0199')).toBe('12125550199');
    expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
  });

  it('resolves company domain idempotently', () => {
    const match = resolveAccountMatch({
      domain: 'www.example.com',
      candidates: [{ id: 'account-1', domain: 'example.com' }],
    });
    expect(match?.candidateAccountId).toBe('account-1');
    expect(canAutoLink(match!)).toBe(true);
  });

  it('resolves contact email deterministically before fuzzy candidates', () => {
    const match = resolveContactMatch({
      email: 'buyer@example.com',
      fullName: 'Buyer Person',
      candidates: [
        {
          id: 'contact-1',
          normalized_email: 'buyer@example.com',
          full_name: 'Different Name',
        },
      ],
    });
    expect(match?.candidateContactId).toBe('contact-1');
    expect(match?.matchType).toBe('deterministic');
  });

  it('does not auto-link a low-confidence name match', () => {
    const match = resolveContactMatch({
      fullName: 'Alex Johnson',
      title: 'Director',
      candidates: [{ id: 'contact-1', full_name: 'Alex Jones', title: 'Manager' }],
    });
    expect(match).toBeNull();
  });
});
