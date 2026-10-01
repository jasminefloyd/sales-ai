import type {
  IntelligenceCapability,
  IntelligenceProvider,
  IntelligenceProviderRegistration,
  ProviderHealthStatus,
} from './intelligenceContracts';

export class IntelligenceProviderRegistry {
  private readonly registrations: IntelligenceProviderRegistration[] = [];

  register(registration: IntelligenceProviderRegistration): void {
    this.registrations.push(registration);
  }

  list(capability: IntelligenceCapability): IntelligenceProviderRegistration[] {
    return this.registrations
      .filter(
        (registration) =>
          registration.capability === capability &&
          registration.enabled &&
          registration.qualified &&
          registration.healthStatus !== 'unavailable',
      )
      .sort((left, right) => left.priority - right.priority);
  }

  select(
    capability: IntelligenceCapability,
  ): IntelligenceProviderRegistration | undefined {
    return this.list(capability)[0];
  }

  health(providerKey: string): ProviderHealthStatus | undefined {
    return this.registrations.find(
      (entry) => entry.provider.providerKey === providerKey,
    )?.healthStatus;
  }

  providers(): readonly IntelligenceProvider[] {
    return [
      ...new Map(
        this.registrations.map((entry) => [entry.provider.providerKey, entry.provider]),
      ).values(),
    ];
  }
}
