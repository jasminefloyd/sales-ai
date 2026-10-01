export type PostHogEvent = {
  event: string;
  distinct_id?: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
};

export type ProductEventMapping = {
  eventName: string;
  conversionType?: 'signup' | 'trial' | 'purchase' | 'subscription' | 'other';
};

export function mapPostHogEvent(event: PostHogEvent, mapping: ProductEventMapping) {
  if (event.event !== mapping.eventName) return null;
  return {
    eventType: event.event,
    occurredAt: event.timestamp,
    customerExternalId: event.distinct_id,
    dimensions: {
      provider: 'posthog',
      properties: event.properties ?? {},
      conversionType: mapping.conversionType ?? null,
    },
  };
}
