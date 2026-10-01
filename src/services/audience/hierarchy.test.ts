import { describe, expect, it } from 'vitest';
import { partitionAudiencesByIcp } from './hierarchy';

describe('audience hierarchy', () => {
  it('keeps audiences with missing ICP parents visible as explicitly ungrouped', () => {
    const result = partitionAudiencesByIcp(
      [
        { icp_id: 'known', icp_version: 1, audience_version: 1, id: 'a1' },
        { icp_id: 'missing', icp_version: 1, audience_version: 1, id: 'a2' },
        { icp_id: null, icp_version: 0, audience_version: 1, id: 'a3' },
      ],
      ['known'],
    );

    expect(result.ungrouped.map((audience) => audience.id)).toEqual(['a2']);
    expect(result.grouped.known?.map((audience) => audience.id)).toEqual(['a1']);
    expect(result.grouped.unassigned?.map((audience) => audience.id)).toEqual([
      'a3',
      'a2',
    ]);
  });
});
