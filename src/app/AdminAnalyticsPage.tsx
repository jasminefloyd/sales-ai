import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import {
  loadAnalyticsSnapshot,
  type AnalyticsDateRange,
  type AnalyticsSnapshot,
} from '../services/analytics/analyticsService';

type View = 'overview' | 'funnels' | 'events' | 'sales-ai';

function defaultRange(): AnalyticsDateRange {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);
  return { from: start.toISOString(), to: end.toISOString() };
}

function dateInput(value: string): string {
  return value.slice(0, 10);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    value,
  );
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Change({ current, previous }: { current: number; previous?: number }) {
  if (previous == null || previous === 0) return null;
  const change = (current - previous) / previous;
  return (
    <span className="muted">
      {' '}
      ({change >= 0 ? '+' : ''}
      {(change * 100).toFixed(1)}% vs prior)
    </span>
  );
}

export function AdminAnalyticsPage() {
  const [range, setRange] = useState(defaultRange);
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<AnalyticsSnapshot | null>(
    null,
  );
  const [view, setView] = useState<View>('overview');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [funnelAudience, setFunnelAudience] = useState<'all' | 'sales'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadAnalyticsSnapshot(supabaseBrowserClient, range);
      const duration = new Date(range.to).getTime() - new Date(range.from).getTime();
      const previousTo = new Date(new Date(range.from).getTime() - 1).toISOString();
      const previousFrom = new Date(
        new Date(range.from).getTime() - duration - 1,
      ).toISOString();
      const previous = await loadAnalyticsSnapshot(supabaseBrowserClient, {
        from: previousFrom,
        to: previousTo,
      });
      setSnapshot(current);
      setPreviousSnapshot(previous);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Unable to load analytics.',
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  function setDate(field: 'from' | 'to', value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (field === 'to') date.setUTCHours(23, 59, 59, 999);
    setRange((current) => ({ ...current, [field]: date.toISOString() }));
  }

  return (
    <section className="page-section">
      <p className="eyebrow">Admin</p>
      <h2>Analytics</h2>
      <p className="muted">
        First-party product funnel and Sales AI acquisition performance.
      </p>
      <p>
        <Link className="button-secondary" to="/admin/audience-intelligence">
          Open Audience Intelligence
        </Link>
      </p>
      <div className="panel analytics-toolbar">
        <label>
          From
          <input
            type="date"
            value={dateInput(range.from)}
            onChange={(event) => setDate('from', event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={dateInput(range.to)}
            onChange={(event) => setDate('to', event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <>
          <div className="analytics-tabs" role="tablist" aria-label="Analytics views">
            {(['overview', 'funnels', 'events', 'sales-ai'] as View[]).map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === item}
                className={
                  view === item ? 'button-secondary active' : 'button-secondary'
                }
                onClick={() => setView(item)}
                key={item}
              >
                {item === 'sales-ai'
                  ? 'Sales AI'
                  : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          {view === 'overview' && (
            <div className="stack">
              <div className="metric-grid">
                <Metric label="Visitors" value={snapshot.overview.visitors} />
                <Metric label="Signups" value={snapshot.overview.signups} />
                <Metric label="Trials" value={snapshot.overview.trials} />
                <Metric
                  label="Paid customers"
                  value={snapshot.overview.paidCustomers}
                />
                <Metric
                  label="Revenue"
                  value={formatCurrency(snapshot.overview.revenue)}
                />
                <Metric
                  label="Sales AI signups"
                  value={snapshot.overview.salesOsSignups}
                />
                <Metric
                  label="Sales AI customers"
                  value={snapshot.overview.salesOsCustomers}
                />
                <Metric
                  label="Sales AI revenue"
                  value={formatCurrency(snapshot.overview.salesOsRevenue)}
                />
                <Metric
                  label="Sales AI cost"
                  value={formatCurrency(snapshot.overview.salesOsCost)}
                />
                <Metric
                  label="Qualified opportunities"
                  value={snapshot.overview.qualifiedOpportunities}
                />
                <Metric
                  label="Activation rate"
                  value={formatPercent(snapshot.overview.activationRate)}
                />
                <Metric
                  label="Cost / qualified opportunity"
                  value={
                    snapshot.overview.costPerQualifiedOpportunity == null
                      ? '—'
                      : formatCurrency(snapshot.overview.costPerQualifiedOpportunity)
                  }
                />
              </div>
              {previousSnapshot && (
                <p className="muted">
                  Prior-period comparison — Visitors{' '}
                  <Change
                    current={snapshot.overview.visitors}
                    previous={previousSnapshot.overview.visitors}
                  />{' '}
                  · Signups{' '}
                  <Change
                    current={snapshot.overview.signups}
                    previous={previousSnapshot.overview.signups}
                  />{' '}
                  · Revenue{' '}
                  <Change
                    current={snapshot.overview.revenue}
                    previous={previousSnapshot.overview.revenue}
                  />{' '}
                  · Sales OS signups{' '}
                  <Change
                    current={snapshot.overview.salesOsSignups}
                    previous={previousSnapshot.overview.salesOsSignups}
                  />
                </p>
              )}
              <div className="panel">
                <h3>Product funnel</h3>
                <FunnelTable steps={snapshot.productFunnel} />
              </div>
            </div>
          )}
          {view === 'funnels' && (
            <div className="panel">
              <div className="analytics-tabs" role="group" aria-label="Funnel audience">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setFunnelAudience('all')}
                  aria-pressed={funnelAudience === 'all'}
                >
                  All users
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setFunnelAudience('sales')}
                  aria-pressed={funnelAudience === 'sales'}
                >
                  Sales OS acquired
                </button>
              </div>
              <h3>
                {funnelAudience === 'all'
                  ? 'Product funnel'
                  : 'Sales AI acquired users'}
              </h3>
              <FunnelTable
                steps={
                  funnelAudience === 'all'
                    ? snapshot.productFunnel
                    : snapshot.salesOsFunnel
                }
              />
            </div>
          )}
          {view === 'events' && (
            <div className="panel">
              <h3>Event explorer</h3>
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Unique users</th>
                    <th>Total events</th>
                    <th>Trend</th>
                    <th>Properties</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.eventSummary.map((event) => (
                    <tr key={event.eventName}>
                      <td>{event.eventName}</td>
                      <td>{event.uniqueUsers}</td>
                      <td>{event.totalEvents}</td>
                      <td>
                        {event.trend
                          .map((point) => `${point.date}: ${point.events}`)
                          .join(' · ') || '—'}
                      </td>
                      <td>
                        <code>{JSON.stringify(event.properties)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view === 'sales-ai' && (
            <div className="stack">
              <div className="metric-grid">
                <Metric
                  label="Cost / signup"
                  value={
                    snapshot.overview.costPerSignup == null
                      ? '—'
                      : formatCurrency(snapshot.overview.costPerSignup)
                  }
                />
                <Metric
                  label="Cost / customer"
                  value={
                    snapshot.overview.costPerConversion == null
                      ? '—'
                      : formatCurrency(snapshot.overview.costPerConversion)
                  }
                />
                <Metric
                  label="Revenue / cost"
                  value={
                    snapshot.overview.salesOsCost
                      ? `${(snapshot.overview.salesOsRevenue / snapshot.overview.salesOsCost).toFixed(2)}x`
                      : '—'
                  }
                />
              </div>
              <div className="panel">
                <h3>Sales AI acquisition funnel</h3>
                <FunnelTable steps={snapshot.salesOsFunnel} />
              </div>
              <div className="panel">
                <h3>Acquisition breakdowns</h3>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Dimension</th>
                      <th>Value</th>
                      <th>Opportunities</th>
                      <th>Executed engagements</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.breakdowns.map((row) => (
                      <tr key={row.dimension}>
                        <td>{row.dimension}</td>
                        <td>{row.value}</td>
                        <td>{row.opportunities}</td>
                        <td>{row.engagements}</td>
                        <td>{formatCurrency(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FunnelTable({ steps }: { steps: AnalyticsSnapshot['productFunnel'] }) {
  return (
    <table className="analytics-table">
      <thead>
        <tr>
          <th>Step</th>
          <th>Users</th>
          <th>Step conversion</th>
          <th>Total conversion</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.name}>
            <td>{step.name}</td>
            <td>{step.users}</td>
            <td>{formatPercent(step.conversionFromPrevious)}</td>
            <td>{formatPercent(step.totalConversion)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
