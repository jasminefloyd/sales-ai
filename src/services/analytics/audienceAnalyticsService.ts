import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type AudienceAnalyticsRange = { from: string; to: string };

type Row = Record<string, unknown>;

export type AudienceAnalyticsSnapshot = {
  range: AudienceAnalyticsRange;
  overview: {
    discovered: number;
    resolved: number;
    enriched: number;
    verified: number;
    ready: number;
    activated: number;
    engaged: number;
    qualified: number;
    converted: number;
    activationRate: number;
    matchRate: number;
    conversionRate: number;
  };
  funnel: Array<{
    stage: string;
    count: number;
    conversionFromPrevious: number | null;
  }>;
  audiences: Array<{
    id: string;
    name: string;
    icpId: string | null;
    discovered: number;
    ready: number;
    activated: number;
    engaged: number;
    qualified: number;
    converted: number;
  }>;
  signals: Array<{
    signalId: string;
    scored: number;
    opportunities: number;
    qualified: number;
    converted: number;
    revenue: number;
  }>;
  providers: Array<{
    providerId: string;
    runs: number;
    succeeded: number;
    failed: number;
    successRate: number;
    cost: number;
  }>;
  channels: Array<{
    channel: string;
    engagements: number;
    qualified: number;
    converted: number;
  }>;
  activations: Array<{
    activationId: string;
    destination: string;
    status: string;
    total: number;
    synced: number;
    failed: number;
    matchRate: number;
  }>;
  attribution: {
    firstTouchRevenue: number;
    lastTouchRevenue: number;
    firstTouchConversions: number;
    lastTouchConversions: number;
  };
};

function inRange(value: unknown, range: AudienceAnalyticsRange) {
  const date = String(value ?? '');
  return date >= range.from && date <= range.to;
}

function id(value: unknown) {
  return String(value ?? '');
}

function countConversion(previous: number, current: number) {
  return previous ? current / previous : 0;
}

export function buildAudienceAnalyticsSnapshot(input: {
  range: AudienceAnalyticsRange;
  audiences: Row[];
  members: Row[];
  enrichments: Row[];
  contacts: Row[];
  quality: Row[];
  activationRecords: Row[];
  syncRuns: Row[];
  opportunities: Row[];
  engagements: Row[];
  events: Row[];
  conversions: Row[];
  providerRuns: Row[];
  providers: Row[];
}): AudienceAnalyticsSnapshot {
  const members = input.members.filter((row) => inRange(row.created_at, input.range));
  const opportunities = input.opportunities.filter((row) =>
    inRange(row.discovered_at, input.range),
  );
  const engagements = input.engagements.filter((row) =>
    inRange(row.created_at, input.range),
  );
  const conversions = input.conversions.filter((row) =>
    inRange(row.converted_at, input.range),
  );
  const enrichments = input.enrichments.filter((row) =>
    inRange(row.created_at, input.range),
  );
  const activationRecords = input.activationRecords.filter((row) =>
    inRange(row.created_at, input.range),
  );
  const events = input.events.filter((row) => inRange(row.occurred_at, input.range));
  const providerRuns = input.providerRuns.filter((row) =>
    inRange(row.started_at, input.range),
  );
  const contactById = new Map(input.contacts.map((row) => [id(row.id), row]));
  const enrichedMembers = new Set(
    enrichments
      .filter((row) => ['succeeded', 'partial'].includes(id(row.status)))
      .map((row) => id(row.member_id)),
  );
  const readyMembers = new Set(
    members.filter((row) => id(row.status) === 'ready').map((row) => id(row.id)),
  );
  const verifiedMembers = new Set(
    members
      .filter((row) => {
        const contact = contactById.get(id(row.contact_id));
        return contact?.email_verification_status === 'valid';
      })
      .map((row) => id(row.id)),
  );
  const activatedMembers = new Set(
    activationRecords
      .filter((row) => id(row.status) === 'synced')
      .map((row) => id(row.member_id)),
  );
  const engagedOpportunities = new Set(
    engagements
      .filter((row) => ['approved', 'queued', 'executed'].includes(id(row.status)))
      .map((row) => id(row.opportunity_id)),
  );
  const qualifiedOpportunities = new Set(
    opportunities
      .filter((row) =>
        [
          'qualified',
          'awaiting_review',
          'approved',
          'engagement_pending',
          'engaged',
          'responded',
          'converted',
        ].includes(id(row.status)),
      )
      .map((row) => id(row.id)),
  );
  const convertedOpportunityIds = new Set(
    conversions.flatMap((row) =>
      [row.first_touch_opportunity_id, row.last_touch_opportunity_id]
        .filter(Boolean)
        .map(id),
    ),
  );
  const funnelCounts = [
    members.length,
    new Set(
      members
        .filter((row) => row.account_id || row.contact_id)
        .map((row) => id(row.id)),
    ).size,
    enrichedMembers.size,
    verifiedMembers.size,
    readyMembers.size,
    activatedMembers.size,
    engagedOpportunities.size,
    qualifiedOpportunities.size,
    convertedOpportunityIds.size,
  ];
  const stages = [
    'Discovered',
    'Resolved',
    'Enriched',
    'Verified',
    'Audience-ready',
    'Activated',
    'Engaged',
    'Qualified',
    'Converted',
  ];
  const funnel = stages.map((stage, index) => ({
    stage,
    count: funnelCounts[index],
    conversionFromPrevious:
      index === 0
        ? null
        : countConversion(funnelCounts[index - 1], funnelCounts[index]),
  }));

  const audiences = input.audiences.map((audience) => {
    const audienceMembers = members.filter(
      (row) => id(row.audience_id) === id(audience.id),
    );
    const audienceOpportunities = opportunities.filter(
      (row) => id(row.audience_id) === id(audience.id),
    );
    return {
      id: id(audience.id),
      name: id(audience.name) || 'Unnamed audience',
      icpId: audience.icp_id ? id(audience.icp_id) : null,
      discovered: audienceMembers.length,
      ready: audienceMembers.filter((row) => readyMembers.has(id(row.id))).length,
      activated: audienceMembers.filter((row) => activatedMembers.has(id(row.id)))
        .length,
      engaged: audienceOpportunities.filter((row) =>
        engagedOpportunities.has(id(row.id)),
      ).length,
      qualified: audienceOpportunities.filter((row) =>
        qualifiedOpportunities.has(id(row.id)),
      ).length,
      converted: audienceOpportunities.filter((row) =>
        convertedOpportunityIds.has(id(row.id)),
      ).length,
    };
  });
  const signalIds = new Set<string>([
    ...opportunities.map((row) => id(row.signal_id)).filter(Boolean),
    ...events
      .filter((row) => id(row.event_type) === 'intent_scored')
      .map((row) => id(row.signal_id))
      .filter(Boolean),
  ]);
  const signals = [...signalIds].map((signalId) => {
    const signalOpportunities = opportunities.filter(
      (row) => id(row.signal_id) === signalId,
    );
    const signalConversions = conversions.filter((row) =>
      signalOpportunities.some(
        (opportunity) =>
          id(opportunity.id) === id(row.first_touch_opportunity_id) ||
          id(opportunity.id) === id(row.last_touch_opportunity_id),
      ),
    );
    return {
      signalId,
      scored: events.filter(
        (row) =>
          id(row.event_type) === 'intent_scored' && id(row.signal_id) === signalId,
      ).length,
      opportunities: signalOpportunities.length,
      qualified: signalOpportunities.filter((row) =>
        qualifiedOpportunities.has(id(row.id)),
      ).length,
      converted: signalConversions.length,
      revenue: signalConversions.reduce((sum, row) => sum + Number(row.value ?? 0), 0),
    };
  });
  const providers = input.providers.map((provider) => {
    const runs = providerRuns.filter((run) => id(run.provider_id) === id(provider.id));
    const succeeded = runs.filter((run) => id(run.status) === 'succeeded').length;
    return {
      providerId: id(provider.provider_key) || id(provider.id),
      runs: runs.length,
      succeeded,
      failed: runs.filter((run) => id(run.status) === 'failed').length,
      successRate: runs.length ? succeeded / runs.length : 0,
      cost: runs.reduce(
        (sum, run) => sum + Number(run.actual_cost ?? run.estimated_cost ?? 0),
        0,
      ),
    };
  });
  const activations = input.syncRuns.map((run) => ({
    activationId: id(run.activation_id),
    destination: id(run.destination_type) || id(run.activation_id),
    status: id(run.status),
    total: Number(run.total_count ?? 0),
    synced: Number(run.synced_count ?? 0),
    failed: Number(run.failed_count ?? 0),
    matchRate: Number(run.total_count ?? 0)
      ? Number(run.synced_count ?? 0) / Number(run.total_count)
      : 0,
  }));
  const channels = [
    ...new Set(engagements.map((row) => id(row.channel)).filter(Boolean)),
  ].map((channel) => {
    const channelEngagements = engagements.filter((row) => id(row.channel) === channel);
    const opportunityIds = new Set(
      channelEngagements.map((row) => id(row.opportunity_id)),
    );
    return {
      channel,
      engagements: channelEngagements.length,
      qualified: [...opportunityIds].filter((opportunityId) =>
        qualifiedOpportunities.has(opportunityId),
      ).length,
      converted: [...opportunityIds].filter((opportunityId) =>
        convertedOpportunityIds.has(opportunityId),
      ).length,
    };
  });
  const dedupeConversions = (
    rows: Row[],
    keyField: 'first_touch_opportunity_id' | 'last_touch_engagement_id',
  ) => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${id(row[keyField])}:${id(row.first_touch_opportunity_id)}:${id(row.last_touch_engagement_id)}:${Number(row.value ?? 0)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const firstTouch = dedupeConversions(
    conversions.filter((row) => row.first_touch_opportunity_id),
    'first_touch_opportunity_id',
  );
  const lastTouch = dedupeConversions(
    conversions.filter((row) => row.last_touch_engagement_id),
    'last_touch_engagement_id',
  );
  const revenue = (rows: Row[]) =>
    rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  const resolved = funnelCounts[1];
  return {
    range: input.range,
    overview: {
      discovered: funnelCounts[0],
      resolved,
      enriched: funnelCounts[2],
      verified: funnelCounts[3],
      ready: funnelCounts[4],
      activated: funnelCounts[5],
      engaged: funnelCounts[6],
      qualified: funnelCounts[7],
      converted: funnelCounts[8],
      activationRate: funnelCounts[4] ? funnelCounts[5] / funnelCounts[4] : 0,
      matchRate: resolved ? funnelCounts[3] / resolved : 0,
      conversionRate: funnelCounts[0] ? funnelCounts[8] / funnelCounts[0] : 0,
    },
    funnel,
    audiences,
    signals,
    providers,
    channels,
    activations,
    attribution: {
      firstTouchRevenue: revenue(firstTouch),
      lastTouchRevenue: revenue(lastTouch),
      firstTouchConversions: firstTouch.length,
      lastTouchConversions: lastTouch.length,
    },
  };
}

export async function loadAudienceAnalyticsSnapshot(
  client: SupabaseClient,
  productId: string,
  range: AudienceAnalyticsRange,
) {
  const query = (table: string, columns: string) =>
    client
      .from(table)
      .select(columns)
      .eq('tenant_id', SALES_OS_TENANT_ID)
      .eq('product_id', productId);
  const [
    audiences,
    members,
    enrichments,
    contacts,
    quality,
    activationRecords,
    syncRuns,
    opportunities,
    engagements,
    events,
    conversions,
    providerRuns,
    providers,
  ] = await Promise.all([
    query('sales_os_audiences', 'id,name,icp_id'),
    query(
      'sales_os_audience_members',
      'id,audience_id,account_id,contact_id,status,created_at,updated_at',
    ),
    query('sales_os_enrichment_records', 'member_id,status,provider_id,created_at'),
    query('sales_os_contacts', 'id,email_verification_status'),
    query(
      'sales_os_audience_quality_snapshots',
      'member_id,readiness_state,calculated_at',
    ),
    query('sales_os_activation_records', 'member_id,activation_id,status,created_at'),
    query(
      'sales_os_activation_sync_runs',
      'activation_id,status,total_count,synced_count,failed_count,created_at',
    ),
    query('sales_os_opportunities', 'id,audience_id,signal_id,status,discovered_at'),
    query(
      'sales_os_engagements',
      'id,opportunity_id,status,channel,message_angle,cta,created_at',
    ),
    query(
      'sales_os_events',
      'event_type,occurred_at,audience_id,account_id,contact_id,signal_id,provider_id,dimensions',
    ),
    query(
      'sales_os_conversions',
      'id,value,converted_at,first_touch_opportunity_id,last_touch_engagement_id',
    ),
    query(
      'sales_os_provider_runs',
      'provider_id,status,started_at,actual_cost,estimated_cost',
    ),
    client
      .from('sales_os_providers')
      .select('id,provider_key')
      .eq('tenant_id', SALES_OS_TENANT_ID),
  ]);
  const result = [
    audiences,
    members,
    enrichments,
    contacts,
    quality,
    activationRecords,
    syncRuns,
    opportunities,
    engagements,
    events,
    conversions,
    providerRuns,
    providers,
  ].find((item) => item.error);
  if (result?.error) throw result.error;
  return buildAudienceAnalyticsSnapshot({
    range,
    audiences: (audiences.data ?? []) as unknown as Row[],
    members: (members.data ?? []) as unknown as Row[],
    enrichments: (enrichments.data ?? []) as unknown as Row[],
    contacts: (contacts.data ?? []) as unknown as Row[],
    quality: (quality.data ?? []) as unknown as Row[],
    activationRecords: (activationRecords.data ?? []) as unknown as Row[],
    syncRuns: (syncRuns.data ?? []) as unknown as Row[],
    opportunities: (opportunities.data ?? []) as unknown as Row[],
    engagements: (engagements.data ?? []) as unknown as Row[],
    events: (events.data ?? []) as unknown as Row[],
    conversions: (conversions.data ?? []) as unknown as Row[],
    providerRuns: (providerRuns.data ?? []) as unknown as Row[],
    providers: (providers.data ?? []) as unknown as Row[],
  });
}
