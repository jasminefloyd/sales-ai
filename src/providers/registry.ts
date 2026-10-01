import type { CapabilityName, CapabilityProvider } from './capabilities';

export type ProviderRegistration = {
  providerId: string;
  provider: CapabilityProvider;
  capability: CapabilityName;
  enabled: boolean;
  qualified: boolean;
  priority: number;
};

export class ProviderRegistry {
  private readonly registrations: ProviderRegistration[] = [];

  register(registration: ProviderRegistration): void {
    this.registrations.push(registration);
  }

  list(capability: CapabilityName): ProviderRegistration[] {
    return this.registrations
      .filter(
        (registration) =>
          registration.capability === capability &&
          registration.enabled &&
          registration.qualified,
      )
      .sort((a, b) => a.priority - b.priority);
  }

  select(capability: CapabilityName): ProviderRegistration | undefined {
    return this.list(capability)[0];
  }
}

export function supportsFallback(
  capability: CapabilityName,
  qualifiedProviders: readonly ProviderRegistration[],
): boolean {
  return (
    ['findContact', 'reasoning'].includes(capability) && qualifiedProviders.length > 1
  );
}
