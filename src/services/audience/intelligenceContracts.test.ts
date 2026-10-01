import { describe, expect, it } from 'vitest';

import {
  AudienceMemberSchema,
  buildAudienceActivationInsert,
  buildAudienceMemberInsert,
  buildIdentityMergeInsert,
} from './intelligenceContracts';

const ids = {
  productId: '123e4567-e89b-12d3-a456-426614174000',
  icpId: '123e4567-e89b-12d3-a456-426614174001',
  audienceId: '123e4567-e89b-12d3-a456-426614174002',
  definitionId: '123e4567-e89b-12d3-a456-426614174003',
  memberId: '123e4567-e89b-12d3-a456-426614174004',
  accountId: '123e4567-e89b-12d3-a456-426614174005',
  contactId: '123e4567-e89b-12d3-a456-426614174006',
};

describe('audience intelligence contracts', () => {
  it('requires exactly one operational or external member identity', () => {
    const base = {
      productId: ids.productId,
      icpId: ids.icpId,
      audienceId: ids.audienceId,
      definitionId: ids.definitionId,
      identityType: 'company' as const,
      sourceSystem: 'test',
      confidence: 0.8,
      provenance: [{ source: 'test' }],
      consentState: 'unknown' as const,
      suppressionState: 'not_checked' as const,
      status: 'discovered' as const,
    };
    expect(
      AudienceMemberSchema.safeParse({ ...base, accountId: ids.accountId }).success,
    ).toBe(true);
    expect(
      AudienceMemberSchema.safeParse({
        ...base,
        accountId: ids.accountId,
        contactId: ids.contactId,
      }).success,
    ).toBe(false);
    expect(
      AudienceMemberSchema.safeParse({ ...base, externalEntityKey: 'anon:test' })
        .success,
    ).toBe(true);
  });

  it('builds tenant-scoped members and keeps provenance explicit', () => {
    const row = buildAudienceMemberInsert(
      {
        productId: ids.productId,
        icpId: ids.icpId,
        audienceId: ids.audienceId,
        definitionId: ids.definitionId,
        accountId: ids.accountId,
        identityType: 'company',
        sourceSystem: 'exa',
        sourceRecordId: 'company-1',
        confidence: 0.9,
        provenance: [{ provider: 'exa', observedAt: '2026-09-28T00:00:00.000Z' }],
        consentState: 'unknown',
        suppressionState: 'clear',
        status: 'ready',
      },
      'test-actor',
    );
    expect(row.tenant_id).toBe('sales_os');
    expect(row.account_id).toBe(ids.accountId);
    expect(row.contact_id).toBeNull();
    expect(row.provenance).toEqual([
      { provider: 'exa', observedAt: '2026-09-28T00:00:00.000Z' },
    ]);
  });

  it('does not allow an identity merge without a source and target', () => {
    expect(() =>
      buildIdentityMergeInsert(
        {
          productId: ids.productId,
          memberId: ids.memberId,
          confidence: 0.4,
          mergeBasis: { match: 'name' },
          provenance: [],
          status: 'pending',
        },
        'test-actor',
      ),
    ).toThrow();
  });

  it('defaults activation rows to the explicit workflow status supplied by the caller', () => {
    const row = buildAudienceActivationInsert(
      {
        productId: ids.productId,
        icpId: ids.icpId,
        audienceId: ids.audienceId,
        definitionId: ids.definitionId,
        destinationType: 'csv',
        destinationName: 'Review export',
        destinationConfig: {},
        memberFilter: { readinessState: 'ready' },
        status: 'pending_approval',
      },
      'test-actor',
    );
    expect(row.status).toBe('pending_approval');
    expect(row.approval_id).toBeNull();
  });
});
