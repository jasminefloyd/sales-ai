import { describe, expect, it } from 'vitest';

import { parseConsoleCommand } from './consoleCommands';

describe('Sales Console command parsing', () => {
  it('routes read-only questions to canonical read tools', () => {
    expect(
      parseConsoleCommand('What have we learned this month?', 'product-1').tool,
    ).toBe('get_learnings');
    expect(parseConsoleCommand('high intent procurement', 'product-1')).toEqual({
      tool: 'search_opportunities',
      input: { productId: 'product-1', query: 'high intent procurement' },
    });
  });

  it('routes state-changing requests to pending approval actions', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(parseConsoleCommand(`reject opportunity ${id}`, 'product-1')).toEqual({
      tool: 'request_opportunity_rejection',
      input: { productId: 'product-1', entityId: id },
    });
    expect(
      parseConsoleCommand(`why was opportunity ${id} qualified?`, 'product-1').tool,
    ).toBe('get_opportunity');
    expect(
      parseConsoleCommand(`draft engagement for opportunity ${id}`, 'product-1'),
    ).toEqual({
      tool: 'request_engagement_draft',
      input: { productId: 'product-1', entityId: id },
    });
    expect(parseConsoleCommand('Stop targeting acting schools', 'product-1')).toEqual({
      tool: 'request_audience_change',
      input: { productId: 'product-1', instruction: 'acting schools' },
    });
  });
});
