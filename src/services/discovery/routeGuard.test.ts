import { describe, expect, it } from 'vitest';

import { isApprovedFindRouteStatus } from './routeGuard';

describe('Find route guard', () => {
  it('allows only approved or active routes', () => {
    expect(isApprovedFindRouteStatus('approved')).toBe(true);
    expect(isApprovedFindRouteStatus('active')).toBe(true);
    expect(isApprovedFindRouteStatus('proposed')).toBe(false);
    expect(isApprovedFindRouteStatus('paused')).toBe(false);
  });
});
