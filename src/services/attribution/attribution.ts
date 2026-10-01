export type AttributionEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
  opportunity_id?: string | null;
  engagement_id?: string | null;
  dimensions: Record<string, unknown>;
};

export type AttributionResult = {
  firstTouch: AttributionEvent | null;
  lastTouch: AttributionEvent | null;
  windowDays: number;
};

export function calculateAttribution(
  events: readonly AttributionEvent[],
  convertedAt: string,
  windowDays = 30,
): AttributionResult {
  if (!Number.isInteger(windowDays) || windowDays <= 0)
    throw new Error('Attribution window must be a positive integer.');
  const conversionTime = new Date(convertedAt).getTime();
  if (!Number.isFinite(conversionTime))
    throw new Error('Invalid conversion timestamp.');
  const firstTouch =
    [...events]
      .filter(
        (event) =>
          event.event_type === 'opportunity_discovered' && event.opportunity_id,
      )
      .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))[0] ?? null;
  const windowStart = conversionTime - windowDays * 86_400_000;
  const lastTouch =
    [...events]
      .filter(
        (event) =>
          Boolean(event.engagement_id) &&
          Date.parse(event.occurred_at) <= conversionTime &&
          Date.parse(event.occurred_at) >= windowStart &&
          ['engagement_executed', 'response_received'].includes(event.event_type),
      )
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
  return { firstTouch, lastTouch, windowDays };
}

export function conversionEventMatches(
  configuredEvent: Record<string, unknown> | null | undefined,
  incomingEventType: string,
): boolean {
  const configuredName = configuredEvent?.eventName;
  return (
    typeof configuredName === 'string' && configuredName.trim() === incomingEventType
  );
}
