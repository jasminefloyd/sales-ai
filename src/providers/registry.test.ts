import { describe, expect, it } from 'vitest';

import { createUnavailableAdapter } from './adapters/unavailable';
import { ProviderRegistry, supportsFallback } from './registry';

describe('provider registry', () => {
  it('selects enabled qualified providers by priority', () => {
    const registry = new ProviderRegistry();
    registry.register({
      providerId: 'provider-slow',
      provider: createUnavailableAdapter('slow', ['findContact']),
      capability: 'findContact',
      enabled: true,
      qualified: true,
      priority: 20,
    });
    registry.register({
      providerId: 'provider-fast',
      provider: createUnavailableAdapter('fast', ['findContact']),
      capability: 'findContact',
      enabled: true,
      qualified: true,
      priority: 10,
    });
    expect(registry.select('findContact')?.provider.providerKey).toBe('fast');
  });

  it('permits fallback for contact discovery and reasoning', () => {
    expect(supportsFallback('findContact', [{}, {}] as never[])).toBe(true);
    expect(supportsFallback('reasoning', [{}, {}] as never[])).toBe(true);
    expect(supportsFallback('searchWeb', [{}, {}] as never[])).toBe(false);
    expect(supportsFallback('findContact', [{}] as never[])).toBe(false);
  });
});
