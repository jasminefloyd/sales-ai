import type { SupabaseClient } from '@supabase/supabase-js';

import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type AnalyticsDateRange = { from: string; to: string };

type AdminEvent = {
  id: string;
  event_name: string;
  occurred_at: string;
  user_id: string | null;
  anonymous_id: string | null;
  sales_attribution_id: string | null;
  sales_opportunity_id: string | null;
  sales_engagement_id: string | null;
  properties: Record<string, unknown>;
  is_internal: boolean;
};

type Opportunity = {
  id: string;
  status: string;
  audience_id: string;
  route_type: string;
  source_id: string;
  signal_id: string | null;
  discovered_at: string;
};

type Engagement = {
  id: string;
  opportunity_id: string;
  status: string;
  channel: string;
  message_angle: string | null;
  cta: string | null;
};

type SalesEvent = {
  event_type: string;
  occurred_at: string;
  opportunity_id: string | null;
  engagement_id: string | null;
  dimensions: Record<string, unknown>;
};

type Conversion = {
  conversion_type: string;
  value: number | null;
  converted_at: string;
  first_touch_opportunity_id: string | null;
  last_touch_engagement_id: string | null;
};

type ProviderRun = {
  provider_id?: string | null;
  provider_key?: string | null;
  actual_cost: number | null;
  estimated_cost: number;
  status: string;
};

export type FunnelStep = {
  name: string;
  users: number;
  conversionFromPrevious: number | null;
  totalConversion: number;
};

export type AnalyticsSnapshot = {
  range: AnalyticsDateRange;
  overview: {
    visitors: number;
    signups: number;
    trials: number;
    paidCustomers: number;
    revenue: number;
    salesOsSignups: number;
    salesOsCustomers: number;
    salesOsRevenue: number;
    salesOsCost: number;
    qualifiedOpportunities: number;
    activationRate: number;
    costPerQualifiedOpportunity: number | null;
    costPerSignup: number | null;
    costPerConversion: number | null;
  };
  productFunnel: FunnelStep[];
  salesOsFunnel: FunnelStep[];
  eventSummary: Array<{
    eventName: string;
    uniqueUsers: number;
    totalEvents: number;
    trend: Array<{ date: string; events: number }>;
    properties: Record<string, unknown>[];
  }>;
  breakdowns: Array<{
    dimension: string;
    value: string;
    opportunities: number;
    engagements: number;
    revenue: number;
    cost: number;
  }>;
};

const productFunnel = [
  ['Visit', ['product_visit']],
  ['Signup', ['user_signed_up']],
  ['Trial', ['trial_started']],
  ['Scene Created', ['scene_created']],
  ['Rehearsal Started', ['rehearsal_started']],
  ['Rehearsal Completed', ['rehearsal_completed']],
  ['Paid', ['pass_purchased', 'subscription_started', 'trial_converted']],
] as const;

function buildIdentityAliases(events: AdminEvent[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const event of events) {
    const anonymousId =
      event.event_name === 'identity_linked'
        ? String(event.properties.anonymous_id ?? event.anonymous_id ?? '')
        : (event.anonymous_id ?? '');
    if (anonymousId && event.user_id) aliases.set(anonymousId, event.user_id);
  }
  return aliases;
}

function identity(
  event: Pick<AdminEvent, 'user_id' | 'anonymous_id'>,
  aliases = new Map<string, string>(),
): string {
  return (
    event.user_id ??
    (event.anonymous_id
      ? (aliases.get(event.anonymous_id) ?? event.anonymous_id)
      : null) ??
    'unknown'
  );
}

function uniqueEventUsers(
  events: AdminEvent[],
  names: readonly string[],
  aliases: Map<string, string>,
): Set<string> {
  return new Set(
    events
      .filter((event) => names.includes(event.event_name))
      .map((event) => identity(event, aliases)),
  );
}

function buildFunnel(
  events: AdminEvent[],
  steps: readonly (readonly [string, readonly string[]])[],
  aliases: Map<string, string>,
): FunnelStep[] {
  let previous = 0;
  const first = uniqueEventUsers(events, steps[0]?.[1] ?? [], aliases).size;
  return steps.map(([name, names], index) => {
    const users = uniqueEventUsers(events, names, aliases).size;
    const result = {
      name,
      users,
      conversionFromPrevious: index === 0 ? null : previous ? users / previous : 0,
      totalConversion: first ? users / first : 0,
    };
    previous = users;
    return result;
  });
}

function isInRange(value: string, range: AnalyticsDateRange): boolean {
  return value >= range.from && value <= range.to;
}

export function buildAnalyticsSnapshot(input: {
  range: AnalyticsDateRange;
  adminEvents: AdminEvent[];
  opportunities: Opportunity[];
  engagements: Engagement[];
  salesEvents: SalesEvent[];
  conversions: Conversion[];
  providerRuns: ProviderRun[];
}): AnalyticsSnapshot {
  const events = input.adminEvents.filter(
    (event) => !event.is_internal && isInRange(event.occurred_at, input.range),
  );
  const salesEvents = input.salesEvents.filter((event) =>
    isInRange(event.occurred_at, input.range),
  );
  const conversions = input.conversions.filter((conversion) =>
    isInRange(conversion.converted_at, input.range),
  );
  const identityAliases = buildIdentityAliases(input.adminEvents);
  const opportunityIds = new Set(
    input.opportunities.map((opportunity) => opportunity.id),
  );
  const attributed = events.filter((event) =>
    Boolean(
      event.sales_attribution_id ||
      event.sales_opportunity_id ||
      event.sales_engagement_id,
    ),
  );
  const salesOsSignups = new Set(
    attributed
      .filter((event) => event.event_name === 'user_signed_up')
      .map((event) => identity(event, identityAliases)),
  ).size;
  const salesOsPaidEvents = attributed.filter((event) =>
    ['pass_purchased', 'subscription_started', 'trial_converted'].includes(
      event.event_name,
    ),
  );
  const salesOsConversionIds = new Set(
    conversions
      .filter(
        (conversion) =>
          conversion.first_touch_opportunity_id &&
          opportunityIds.has(conversion.first_touch_opportunity_id),
      )
      .map((conversion) => conversion.first_touch_opportunity_id),
  );
  const salesOsCustomerIdentities = new Set([
    ...salesOsPaidEvents.map((event) => identity(event, identityAliases)),
    ...[...salesOsConversionIds].filter((value): value is string => Boolean(value)),
  ]);
  const salesOsRevenue = conversions
    .filter(
      (conversion) =>
        conversion.first_touch_opportunity_id &&
        opportunityIds.has(conversion.first_touch_opportunity_id),
    )
    .reduce((sum, conversion) => sum + Number(conversion.value ?? 0), 0);
  const paidCustomers = new Set(
    events
      .filter((event) =>
        ['pass_purchased', 'subscription_started', 'trial_converted'].includes(
          event.event_name,
        ),
      )
      .map((event) => identity(event, identityAliases)),
  );
  const salesOsCost = input.providerRuns.reduce(
    (sum, run) => sum + Number(run.actual_cost ?? run.estimated_cost ?? 0),
    0,
  );
  const qualifiedOpportunities = input.opportunities.filter((opportunity) =>
    [
      'qualified',
      'awaiting_review',
      'approved',
      'engagement_pending',
      'engaged',
      'responded',
      'converted',
    ].includes(opportunity.status),
  ).length;
  const activationRate = input.opportunities.length
    ? input.engagements.filter((engagement) =>
        ['approved', 'queued', 'executed'].includes(engagement.status),
      ).length / input.opportunities.length
    : 0;
  const eventSummary = [...new Set(events.map((event) => event.event_name))]
    .sort()
    .map((eventName) => {
      const matching = events.filter((event) => event.event_name === eventName);
      return {
        eventName,
        uniqueUsers: new Set(matching.map((event) => identity(event, identityAliases)))
          .size,
        totalEvents: matching.length,
        trend: [
          ...matching.reduce((counts, event) => {
            const date = event.occurred_at.slice(0, 10);
            counts.set(date, (counts.get(date) ?? 0) + 1);
            return counts;
          }, new Map<string, number>()),
        ].map(([date, count]) => ({ date, events: count })),
        properties: matching.slice(0, 5).map((event) => event.properties),
      };
    });
  const breakdownMap = new Map<
    string,
    {
      dimension: string;
      value: string;
      opportunities: number;
      engagements: number;
      revenue: number;
      cost: number;
    }
  >();
  const addBreakdown = (
    dimension: string,
    value: unknown,
    opportunity?: Opportunity,
    engagementCount = 0,
  ) => {
    if (value === null || value === undefined || String(value).trim() === '') return;
    const key = `${dimension}:${String(value)}`;
    const current = breakdownMap.get(key) ?? {
      dimension,
      value: String(value),
      opportunities: 0,
      engagements: 0,
      revenue: 0,
      cost: 0,
    };
    if (opportunity) {
      current.opportunities += 1;
      current.engagements += engagementCount;
      current.revenue += conversions
        .filter(
          (conversion) => conversion.first_touch_opportunity_id === opportunity.id,
        )
        .reduce((sum, conversion) => sum + Number(conversion.value ?? 0), 0);
    }
    breakdownMap.set(key, current);
  };
  for (const opportunity of input.opportunities) {
    const engagementCount = input.engagements.filter(
      (engagement) =>
        engagement.opportunity_id === opportunity.id &&
        engagement.status === 'executed',
    ).length;
    addBreakdown('audience', opportunity.audience_id, opportunity, engagementCount);
    addBreakdown('route', opportunity.route_type, opportunity, engagementCount);
    addBreakdown('source', opportunity.source_id, opportunity, engagementCount);
    addBreakdown('signal', opportunity.signal_id, opportunity, engagementCount);
    for (const engagement of input.engagements.filter(
      (item) => item.opportunity_id === opportunity.id,
    )) {
      addBreakdown(
        'engagement_type',
        engagement.channel,
        opportunity,
        engagement.status === 'executed' ? 1 : 0,
      );
      addBreakdown(
        'message_angle',
        engagement.message_angle,
        opportunity,
        engagement.status === 'executed' ? 1 : 0,
      );
      addBreakdown(
        'cta',
        engagement.cta,
        opportunity,
        engagement.status === 'executed' ? 1 : 0,
      );
    }
  }
  for (const run of input.providerRuns)
    addBreakdown('provider', run.provider_key ?? run.provider_id, undefined);
  return {
    range: input.range,
    overview: {
      visitors: uniqueEventUsers(events, ['product_visit'], identityAliases).size,
      signups: uniqueEventUsers(events, ['user_signed_up'], identityAliases).size,
      trials: uniqueEventUsers(events, ['trial_started'], identityAliases).size,
      paidCustomers: paidCustomers.size,
      revenue: conversions.reduce(
        (sum, conversion) => sum + Number(conversion.value ?? 0),
        0,
      ),
      salesOsSignups,
      salesOsCustomers: salesOsCustomerIdentities.size,
      salesOsRevenue,
      salesOsCost,
      qualifiedOpportunities,
      activationRate,
      costPerQualifiedOpportunity: qualifiedOpportunities
        ? salesOsCost / qualifiedOpportunities
        : null,
      costPerSignup: salesOsSignups ? salesOsCost / salesOsSignups : null,
      costPerConversion: salesOsCustomerIdentities.size
        ? salesOsCost / salesOsCustomerIdentities.size
        : null,
    },
    productFunnel: buildFunnel(events, productFunnel, identityAliases),
    salesOsFunnel: [
      {
        name: 'Discovery',
        users: input.opportunities.length,
        conversionFromPrevious: null,
        totalConversion: 1,
      },
      {
        name: 'Qualified',
        users: input.opportunities.filter((opportunity) =>
          [
            'qualified',
            'awaiting_review',
            'approved',
            'engagement_pending',
            'engaged',
            'responded',
            'converted',
          ].includes(opportunity.status),
        ).length,
        conversionFromPrevious: input.opportunities.length
          ? input.opportunities.filter(
              (opportunity) => opportunity.status !== 'discovered',
            ).length / input.opportunities.length
          : 0,
        totalConversion: input.opportunities.length
          ? input.opportunities.filter(
              (opportunity) => opportunity.status !== 'discovered',
            ).length / input.opportunities.length
          : 0,
      },
      {
        name: 'Engaged',
        users: input.engagements.filter((engagement) =>
          ['approved', 'queued', 'executed'].includes(engagement.status),
        ).length,
        conversionFromPrevious: null,
        totalConversion: input.opportunities.length
          ? input.engagements.length / input.opportunities.length
          : 0,
      },
      {
        name: 'Response',
        users: new Set(
          salesEvents
            .filter(
              (event) =>
                event.event_type === 'response_received' && event.engagement_id,
            )
            .map((event) => event.engagement_id),
        ).size,
        conversionFromPrevious: null,
        totalConversion: input.opportunities.length
          ? new Set(
              salesEvents
                .filter((event) => event.event_type === 'response_received')
                .map((event) => event.opportunity_id),
            ).size / input.opportunities.length
          : 0,
      },
      {
        name: 'Visit',
        users: new Set(
          attributed
            .filter((event) => event.event_name === 'product_visit')
            .map((event) => identity(event, identityAliases)),
        ).size,
        conversionFromPrevious: null,
        totalConversion: input.opportunities.length
          ? attributed.filter((event) => event.event_name === 'product_visit').length /
            input.opportunities.length
          : 0,
      },
      {
        name: 'Signup',
        users: salesOsSignups,
        conversionFromPrevious: null,
        totalConversion: input.opportunities.length
          ? salesOsSignups / input.opportunities.length
          : 0,
      },
      {
        name: 'Paid',
        users: salesOsCustomerIdentities.size,
        conversionFromPrevious: null,
        totalConversion: input.opportunities.length
          ? salesOsCustomerIdentities.size / input.opportunities.length
          : 0,
      },
    ],
    eventSummary,
    breakdowns: [...breakdownMap.values()],
  };
}

export async function loadAnalyticsSnapshot(
  client: SupabaseClient,
  range: AnalyticsDateRange,
): Promise<AnalyticsSnapshot> {
  const query = (table: string, columns: string) =>
    client.from(table).select(columns).eq('tenant_id', SALES_OS_TENANT_ID);
  const [
    { data: adminEvents, error: adminError },
    { data: opportunities, error: opportunityError },
    { data: engagements, error: engagementError },
    { data: salesEvents, error: salesError },
    { data: conversions, error: conversionError },
    { data: providerRuns, error: providerError },
    { data: providers, error: providersError },
  ] = await Promise.all([
    query(
      'sales_os_admin_events',
      'id,event_name,occurred_at,user_id,anonymous_id,sales_attribution_id,sales_opportunity_id,sales_engagement_id,properties,is_internal',
    )
      .gte('occurred_at', range.from)
      .lte('occurred_at', range.to),
    query(
      'sales_os_opportunities',
      'id,status,audience_id,route_type,source_id,signal_id,discovered_at',
    )
      .gte('discovered_at', range.from)
      .lte('discovered_at', range.to),
    query('sales_os_engagements', 'id,opportunity_id,status,channel,message_angle,cta')
      .gte('created_at', range.from)
      .lte('created_at', range.to),
    query(
      'sales_os_events',
      'event_type,occurred_at,opportunity_id,engagement_id,dimensions',
    )
      .gte('occurred_at', range.from)
      .lte('occurred_at', range.to),
    query(
      'sales_os_conversions',
      'conversion_type,value,converted_at,first_touch_opportunity_id,last_touch_engagement_id',
    )
      .gte('converted_at', range.from)
      .lte('converted_at', range.to),
    query('sales_os_provider_runs', 'provider_id,actual_cost,estimated_cost,status')
      .gte('started_at', range.from)
      .lte('started_at', range.to),
    client
      .from('sales_os_providers')
      .select('id,provider_key')
      .eq('tenant_id', SALES_OS_TENANT_ID),
  ]);
  const error =
    adminError ??
    opportunityError ??
    engagementError ??
    salesError ??
    conversionError ??
    providerError ??
    providersError;
  if (error) throw error;
  return buildAnalyticsSnapshot({
    range,
    adminEvents: (adminEvents ?? []) as unknown as AdminEvent[],
    opportunities: (opportunities ?? []) as unknown as Opportunity[],
    engagements: (engagements ?? []) as unknown as Engagement[],
    salesEvents: (salesEvents ?? []) as unknown as SalesEvent[],
    conversions: (conversions ?? []) as unknown as Conversion[],
    providerRuns: ((providerRuns ?? []) as unknown as Array<ProviderRun>).map(
      (run) => ({
        ...run,
        provider_key:
          (providers ?? []).find((provider) => provider.id === run.provider_id)
            ?.provider_key ?? null,
      }),
    ),
  });
}
