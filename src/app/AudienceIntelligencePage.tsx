import { useCallback, useEffect, useState } from 'react';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import {
  loadAudienceAnalyticsSnapshot,
  type AudienceAnalyticsRange,
  type AudienceAnalyticsSnapshot,
} from '../services/analytics/audienceAnalyticsService';

type View =
  'overview' | 'audiences' | 'signals' | 'enrichment' | 'activation' | 'providers';

function rangeDefault(): AudienceAnalyticsRange {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(to.getUTCDate() - 29);
  return { from: from.toISOString(), to: to.toISOString() };
}

function dateValue(value: string) {
  return value.slice(0, 10);
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function AudienceIntelligencePage() {
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [productId, setProductId] = useState('');
  const [range, setRange] = useState(rangeDefault);
  const [snapshot, setSnapshot] = useState<AudienceAnalyticsSnapshot | null>(null);
  const [previousSnapshot, setPreviousSnapshot] =
    useState<AudienceAnalyticsSnapshot | null>(null);
  const [view, setView] = useState<View>('overview');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audienceFilter, setAudienceFilter] = useState('all');
  const [icpFilter, setIcpFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');

  useEffect(() => {
    void supabaseBrowserClient
      .from('sales_os_products')
      .select('id,name')
      .eq('tenant_id', 'sales_os')
      .order('created_at', { ascending: true })
      .then(({ data, error: productError }) => {
        if (productError) setError(productError.message);
        const rows = (data ?? []) as Array<{ id: string; name: string }>;
        setProducts(rows);
        setProductId(rows[0]?.id ?? '');
      });
  }, []);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const current = await loadAudienceAnalyticsSnapshot(
        supabaseBrowserClient,
        productId,
        range,
      );
      const duration = new Date(range.to).getTime() - new Date(range.from).getTime();
      const previous = await loadAudienceAnalyticsSnapshot(
        supabaseBrowserClient,
        productId,
        {
          from: new Date(new Date(range.from).getTime() - duration - 1).toISOString(),
          to: new Date(new Date(range.from).getTime() - 1).toISOString(),
        },
      );
      setSnapshot(current);
      setPreviousSnapshot(previous);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load audience analytics.',
      );
    } finally {
      setLoading(false);
    }
  }, [productId, range]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  function setDate(field: 'from' | 'to', value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (field === 'to') date.setUTCHours(23, 59, 59, 999);
    setRange((current) => ({ ...current, [field]: date.toISOString() }));
  }

  const tabs: View[] = [
    'overview',
    'audiences',
    'signals',
    'enrichment',
    'activation',
    'providers',
  ];
  return (
    <section className="page-section">
      <p className="eyebrow">Audience Intelligence</p>
      <h2>Audience Intelligence</h2>
      <p className="muted">
        Measure each audience from discovery through activation and conversion.
      </p>
      <div className="panel analytics-toolbar">
        <label>
          Product
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={dateValue(range.from)}
            onChange={(event) => setDate('from', event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={dateValue(range.to)}
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
          <div className="panel analytics-toolbar">
            <label>
              ICP
              <select
                value={icpFilter}
                onChange={(event) => setIcpFilter(event.target.value)}
              >
                <option value="all">All ICPs</option>
                {[
                  ...new Set(
                    snapshot.audiences.map((row) => row.icpId).filter(Boolean),
                  ),
                ].map((icp) => (
                  <option key={icp} value={icp!}>
                    {icp}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Audience
              <select
                value={audienceFilter}
                onChange={(event) => setAudienceFilter(event.target.value)}
              >
                <option value="all">All audiences</option>
                {snapshot.audiences.map((audience) => (
                  <option key={audience.id} value={audience.id}>
                    {audience.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Provider
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
              >
                <option value="all">All providers</option>
                {snapshot.providers.map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>
                    {provider.providerId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value)}
              >
                <option value="all">All channels</option>
                {snapshot.channels.map((channel) => (
                  <option key={channel.channel} value={channel.channel}>
                    {channel.channel}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="analytics-tabs"
            role="tablist"
            aria-label="Audience intelligence views"
          >
            {tabs.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === tab}
                className={
                  view === tab ? 'button-secondary active' : 'button-secondary'
                }
                onClick={() => setView(tab)}
                key={tab}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {view === 'overview' && (
            <div className="stack">
              <div className="metric-grid">
                <Metric label="Discovered" value={snapshot.overview.discovered} />
                <Metric label="Resolved" value={snapshot.overview.resolved} />
                <Metric label="Enriched" value={snapshot.overview.enriched} />
                <Metric label="Verified" value={snapshot.overview.verified} />
                <Metric label="Audience-ready" value={snapshot.overview.ready} />
                <Metric label="Activated" value={snapshot.overview.activated} />
                <Metric label="Qualified" value={snapshot.overview.qualified} />
                <Metric label="Converted" value={snapshot.overview.converted} />
              </div>
              {previousSnapshot && (
                <p className="muted">
                  Prior period — discovered{' '}
                  {change(
                    snapshot.overview.discovered,
                    previousSnapshot.overview.discovered,
                  )}{' '}
                  · ready{' '}
                  {change(snapshot.overview.ready, previousSnapshot.overview.ready)} ·
                  converted{' '}
                  {change(
                    snapshot.overview.converted,
                    previousSnapshot.overview.converted,
                  )}
                </p>
              )}
              <div className="panel">
                <h3>Audience lifecycle funnel</h3>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Records</th>
                      <th>From previous</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.funnel.map((step) => (
                      <tr key={step.stage}>
                        <td>{step.stage}</td>
                        <td>{step.count}</td>
                        <td>
                          {step.conversionFromPrevious == null
                            ? '—'
                            : percent(step.conversionFromPrevious)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel">
                <h3>Attribution</h3>
                <p className="muted">
                  First touch: {snapshot.attribution.firstTouchConversions} conversions
                  · ${snapshot.attribution.firstTouchRevenue.toFixed(2)}
                </p>
                <p className="muted">
                  Last touch: {snapshot.attribution.lastTouchConversions} conversions ·
                  ${snapshot.attribution.lastTouchRevenue.toFixed(2)}
                </p>
              </div>
            </div>
          )}
          {view === 'audiences' && (
            <AnalyticsTable
              title="Audience performance"
              headers={[
                'Audience',
                'ICP',
                'Discovered',
                'Ready',
                'Activated',
                'Qualified',
                'Converted',
              ]}
              rows={snapshot.audiences
                .filter(
                  (row) =>
                    (audienceFilter === 'all' || row.id === audienceFilter) &&
                    (icpFilter === 'all' || row.icpId === icpFilter),
                )
                .map((row) => [
                  row.name,
                  row.icpId ?? '—',
                  row.discovered,
                  row.ready,
                  row.activated,
                  row.qualified,
                  row.converted,
                ])}
            />
          )}
          {view === 'signals' && (
            <AnalyticsTable
              title="Signal performance"
              headers={[
                'Signal',
                'Scored',
                'Opportunities',
                'Qualified',
                'Converted',
                'Revenue',
              ]}
              rows={snapshot.signals.map((row) => [
                row.signalId,
                row.scored,
                row.opportunities,
                row.qualified,
                row.converted,
                `$${row.revenue.toFixed(2)}`,
              ])}
            />
          )}
          {view === 'enrichment' && (
            <div className="stack">
              <AnalyticsTable
                title="Enrichment and identity quality"
                headers={['Stage', 'Count', 'Rate']}
                rows={[
                  [
                    'Resolved',
                    snapshot.overview.resolved,
                    percent(snapshot.overview.matchRate),
                  ],
                  [
                    'Enriched',
                    snapshot.overview.enriched,
                    percent(
                      snapshot.overview.discovered
                        ? snapshot.overview.enriched / snapshot.overview.discovered
                        : 0,
                    ),
                  ],
                  [
                    'Verified',
                    snapshot.overview.verified,
                    percent(
                      snapshot.overview.resolved
                        ? snapshot.overview.verified / snapshot.overview.resolved
                        : 0,
                    ),
                  ],
                  [
                    'Audience-ready',
                    snapshot.overview.ready,
                    percent(
                      snapshot.overview.discovered
                        ? snapshot.overview.ready / snapshot.overview.discovered
                        : 0,
                    ),
                  ],
                ]}
              />
              <AnalyticsTable
                title="Channel performance"
                headers={['Channel', 'Engagements', 'Qualified', 'Converted']}
                rows={snapshot.channels
                  .filter(
                    (row) => channelFilter === 'all' || row.channel === channelFilter,
                  )
                  .map((row) => [
                    row.channel,
                    row.engagements,
                    row.qualified,
                    row.converted,
                  ])}
              />
            </div>
          )}
          {view === 'activation' && (
            <AnalyticsTable
              title="Activation and reconciliation"
              headers={[
                'Activation',
                'Destination',
                'Status',
                'Total',
                'Synced',
                'Failed',
                'Match rate',
              ]}
              rows={snapshot.activations.map((row) => [
                row.activationId,
                row.destination,
                row.status,
                row.total,
                row.synced,
                row.failed,
                percent(row.matchRate),
              ])}
            />
          )}
          {view === 'providers' && (
            <AnalyticsTable
              title="Provider quality and cost"
              headers={[
                'Provider',
                'Runs',
                'Succeeded',
                'Failed',
                'Success rate',
                'Cost',
              ]}
              rows={snapshot.providers
                .filter(
                  (row) =>
                    providerFilter === 'all' || row.providerId === providerFilter,
                )
                .map((row) => [
                  row.providerId,
                  row.runs,
                  row.succeeded,
                  row.failed,
                  percent(row.successRate),
                  `$${row.cost.toFixed(2)}`,
                ])}
            />
          )}
        </>
      )}
    </section>
  );
}

function change(current: number, previous: number) {
  if (!previous) return '—';
  const value = ((current - previous) / previous) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function AnalyticsTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <table className="analytics-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`}>
                {row.map((value, cellIndex) => (
                  <td key={`${cellIndex}-${value}`}>{value}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>No data for this range.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
