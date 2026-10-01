export function calculateAttribution(
  events: Array<Record<string, unknown>>,
  convertedAt: string,
  windowDays = 30,
) {
  const conversionTime = Date.parse(convertedAt);
  const windowStart = conversionTime - windowDays * 86_400_000;
  const firstTouch = events
    .filter(
      (event) => event.event_type === 'opportunity_discovered' && event.opportunity_id,
    )
    .sort(
      (a, b) => Date.parse(String(a.occurred_at)) - Date.parse(String(b.occurred_at)),
    )[0];
  const lastTouch = events
    .filter(
      (event) =>
        Boolean(event.engagement_id) &&
        Date.parse(String(event.occurred_at)) <= conversionTime &&
        Date.parse(String(event.occurred_at)) >= windowStart &&
        ['engagement_executed', 'response_received'].includes(String(event.event_type)),
    )
    .sort(
      (a, b) => Date.parse(String(b.occurred_at)) - Date.parse(String(a.occurred_at)),
    )[0];
  return { firstTouch: firstTouch ?? null, lastTouch: lastTouch ?? null };
}
