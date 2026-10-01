import { useEffect, useMemo, useState } from 'react';

import { supabaseBrowserClient } from '../lib/supabase/browser';

type PerformanceData = {
  conversions: Array<{
    value: number | null;
    conversion_type: string;
    first_touch_opportunity_id: string | null;
  }>;
  opportunities: Array<{
    id: string;
    audience_id: string;
    route_type: string;
    source_id: string;
    signal_id: string | null;
    status: string;
  }>;
  events: Array<{ event_type: string }>;
  providerRuns: Array<{
    status: string;
    actual_cost: number | null;
    latency_ms: number | null;
  }>;
  jobs: Array<{ status: string; job_type: string }>;
};

export function PerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [conversions, opportunities, events, providerRuns, jobs] = await Promise.all([
      supabaseBrowserClient
        .from('sales_os_conversions')
        .select('value, conversion_type, first_touch_opportunity_id')
        .eq('tenant_id', 'sales_os'),
      supabaseBrowserClient
        .from('sales_os_opportunities')
        .select('id, audience_id, route_type, source_id, signal_id, status')
        .eq('tenant_id', 'sales_os'),
      supabaseBrowserClient
        .from('sales_os_events')
        .select('event_type')
        .eq('tenant_id', 'sales_os'),
      supabaseBrowserClient
        .from('sales_os_provider_runs')
        .select('status, actual_cost, latency_ms')
        .eq('tenant_id', 'sales_os'),
      supabaseBrowserClient
        .from('sales_os_jobs')
        .select('status, job_type')
        .eq('tenant_id', 'sales_os'),
    ]);
    const failure = [conversions, opportunities, events, providerRuns, jobs].find(
      (result) => result.error,
    );
    if (failure?.error) setError(failure.error.message);
    else
      setData({
        conversions: conversions.data ?? [],
        opportunities: opportunities.data ?? [],
        events: events.data ?? [],
        providerRuns: providerRuns.data ?? [],
        jobs: jobs.data ?? [],
      });
  }

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const metrics = useMemo(() => {
    if (!data) return null;
    const qualified = data.opportunities.filter((item) =>
      [
        'qualified',
        'awaiting_review',
        'approved',
        'engaged',
        'responded',
        'converted',
      ].includes(item.status),
    ).length;
    const converted = data.opportunities.filter(
      (item) => item.status === 'converted',
    ).length;
    const responses = data.events.filter(
      (item) => item.event_type === 'response_received',
    ).length;
    const executed = data.events.filter(
      (item) => item.event_type === 'engagement_executed',
    ).length;
    const paidConversions = data.conversions.filter((item) =>
      ['purchase', 'subscription'].includes(item.conversion_type),
    ).length;
    const signups = data.conversions.filter(
      (item) => item.conversion_type === 'signup',
    ).length;
    const revenue = data.conversions.reduce(
      (sum, item) => sum + Number(item.value ?? 0),
      0,
    );
    const providerCost = data.providerRuns.reduce(
      (sum, item) => sum + Number(item.actual_cost ?? 0),
      0,
    );
    const successfulRuns = data.providerRuns.filter(
      (item) => item.status === 'succeeded',
    );
    const latency = successfulRuns.length
      ? successfulRuns.reduce((sum, item) => sum + Number(item.latency_ms ?? 0), 0) /
        successfulRuns.length
      : 0;
    return {
      qualified,
      converted,
      responses,
      executed,
      paidConversions,
      signups,
      revenue,
      providerCost,
      latency,
      responseRate: executed ? responses / executed : 0,
      signupRate: qualified ? signups / qualified : 0,
      conversionRate: qualified ? converted / qualified : 0,
    };
  }, [data]);

  const revenueByRoute = useMemo(() => {
    if (!data) return [];
    const opportunities = new Map(data.opportunities.map((item) => [item.id, item]));
    const totals = new Map<string, number>();
    for (const conversion of data.conversions) {
      const opportunity = conversion.first_touch_opportunity_id
        ? opportunities.get(conversion.first_touch_opportunity_id)
        : undefined;
      const key = opportunity
        ? `${opportunity.audience_id} · ${opportunity.route_type} · ${opportunity.source_id} · ${opportunity.signal_id ?? 'none'}`
        : 'unattributed';
      totals.set(key, (totals.get(key) ?? 0) + Number(conversion.value ?? 0));
    }
    return [...totals.entries()].map(([key, value]) => ({ key, value }));
  }, [data]);

  return (
    <section className="page-section">
      <p className="eyebrow">Results</p>
      <h2>Operating outcomes</h2>
      <p className="muted">
        Metrics are read from the canonical event, conversion, opportunity,
        provider-run, and job tables.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!metrics ? (
        <div className="empty-state">No performance data is available.</div>
      ) : (
        <>
          <div className="metric-grid">
            <Metric label="Paid conversions" value={String(metrics.paidConversions)} />
            <Metric
              label="Attributed revenue"
              value={`$${metrics.revenue.toFixed(2)}`}
            />
            <Metric label="Qualified opportunities" value={String(metrics.qualified)} />
            <Metric
              label="Response rate"
              value={`${(metrics.responseRate * 100).toFixed(1)}%`}
            />
            <Metric
              label="Signup rate"
              value={`${(metrics.signupRate * 100).toFixed(1)}%`}
            />
            <Metric
              label="Opportunity → conversion"
              value={`${(metrics.conversionRate * 100).toFixed(1)}%`}
            />
            <Metric
              label="Cost / qualified"
              value={`$${(metrics.qualified ? metrics.providerCost / metrics.qualified : 0).toFixed(2)}`}
            />
            <Metric
              label="Cost / conversion"
              value={`$${(metrics.paidConversions ? metrics.providerCost / metrics.paidConversions : 0).toFixed(2)}`}
            />
            <Metric
              label="Provider latency"
              value={`${Math.round(metrics.latency)} ms`}
            />
            <Metric
              label="Failed jobs"
              value={String(
                data?.jobs.filter((job) => job.status === 'failed').length ?? 0,
              )}
            />
          </div>
          <div className="panel stack">
            <h3>Revenue by audience / route / source / signal</h3>
            {revenueByRoute.length === 0 ? (
              <p className="muted">No attributed revenue yet.</p>
            ) : (
              revenueByRoute.map((row) => (
                <div className="route-row" key={row.key}>
                  <span>{row.key}</span>
                  <strong>${row.value.toFixed(2)}</strong>
                </div>
              ))
            )}
          </div>
          <div className="panel stack">
            <h3>Provider execution</h3>
            <p>
              {data?.providerRuns.length ?? 0} runs ·{' '}
              {data?.providerRuns.filter((run) => run.status === 'succeeded').length ??
                0}{' '}
              succeeded · ${metrics.providerCost.toFixed(2)} recorded cost
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
