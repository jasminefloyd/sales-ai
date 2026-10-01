import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { EmptyState, PageHeader, StatusChip } from './designSystem';

type QueueItem = {
  id: string;
  kind: 'Audience' | 'Signal' | 'Draft' | 'Learning';
  title: string;
  reason: string;
  href: string;
};
type TodayMetric = {
  replies: number;
  visits: number;
  signups: number;
  paid: number;
};
type RecentEngagement = {
  id: string;
  channel: string;
  subject: string | null;
  final_content: string | null;
  updated_at: string;
};

export function TodayPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [metricCounts, setMetricCounts] = useState<TodayMetric>({
    replies: 0,
    visits: 0,
    signups: 0,
    paid: 0,
  });
  const [recentSent, setRecentSent] = useState<RecentEngagement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const [
        products,
        audiences,
        opportunities,
        engagements,
        learnings,
        events,
        conversions,
        sent,
      ] = await Promise.all([
        supabaseBrowserClient
          .from('sales_os_products')
          .select('id, name')
          .eq('tenant_id', 'sales_os'),
        supabaseBrowserClient
          .from('sales_os_audiences')
          .select('id, name, problem_use_case_fit')
          .eq('tenant_id', 'sales_os')
          .eq('status', 'proposed')
          .limit(8),
        supabaseBrowserClient
          .from('sales_os_opportunities')
          .select('id, title, summary, signal_type')
          .eq('tenant_id', 'sales_os')
          .eq('status', 'awaiting_review')
          .limit(8),
        supabaseBrowserClient
          .from('sales_os_engagements')
          .select('id, product_id, channel, why_engage')
          .eq('tenant_id', 'sales_os')
          .eq('status', 'awaiting_approval')
          .limit(8),
        supabaseBrowserClient
          .from('sales_os_learnings')
          .select('id, observation')
          .eq('tenant_id', 'sales_os')
          .eq('status', 'proposed')
          .limit(8),
        supabaseBrowserClient
          .from('sales_os_events')
          .select('event_type')
          .eq('tenant_id', 'sales_os')
          .gte('occurred_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
        supabaseBrowserClient
          .from('sales_os_conversions')
          .select('conversion_type')
          .eq('tenant_id', 'sales_os')
          .gte('converted_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
        supabaseBrowserClient
          .from('sales_os_engagements')
          .select('id, channel, subject, final_content, updated_at')
          .eq('tenant_id', 'sales_os')
          .in('status', ['executed', 'sent'])
          .order('updated_at', { ascending: false })
          .limit(3),
      ]);
      const firstError =
        products.error ??
        audiences.error ??
        opportunities.error ??
        engagements.error ??
        learnings.error ??
        events.error ??
        conversions.error ??
        sent.error;
      if (!active) return;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setProductCount(products.data?.length ?? 0);
      const eventRows = events.data ?? [];
      const conversionRows = conversions.data ?? [];
      setMetricCounts({
        replies: eventRows.filter((row) => row.event_type === 'response_received')
          .length,
        visits: eventRows.filter((row) => row.event_type === 'product_visit').length,
        signups: conversionRows.filter((row) => row.conversion_type === 'signup')
          .length,
        paid: conversionRows.filter((row) =>
          ['purchase', 'subscription'].includes(row.conversion_type),
        ).length,
      });
      setRecentSent((sent.data ?? []) as RecentEngagement[]);
      setItems([
        ...(audiences.data ?? []).map((row) => ({
          id: row.id,
          kind: 'Audience' as const,
          title: row.name,
          reason:
            row.problem_use_case_fit ??
            'Review this audience before approving outreach.',
          href: '/sales-os/products',
        })),
        ...(opportunities.data ?? []).map((row) => ({
          id: row.id,
          kind: 'Signal' as const,
          title: row.title ?? 'Review this signal',
          reason: `${row.signal_type ?? 'Signal'} · ${row.summary ?? 'Review the evidence before drafting.'}`,
          href: '/sales-os/opportunities',
        })),
        ...(engagements.data ?? []).map((row) => ({
          id: row.id,
          kind: 'Draft' as const,
          title: `${row.channel ?? 'Channel'} draft`,
          reason: row.why_engage ?? 'Review before sending.',
          href: `/sales-os/engage?product=${row.product_id}`,
        })),
        ...(learnings.data ?? []).map((row) => ({
          id: row.id,
          kind: 'Learning' as const,
          title: 'Learning proposal',
          reason: row.observation ?? 'Review the proposed change.',
          href: '/sales-os/learning',
        })),
      ]);
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const renderGroup = (kind: QueueItem['kind'], label: string) => {
    const group = items.filter((item) => item.kind === kind);
    if (!group.length) return null;
    return (
      <div className="queue-group" key={kind}>
        <div className="queue-section-heading">
          <span>{label}</span>
          <small>
            {kind === 'Signal' ? 'Oldest first' : `${group.length} waiting`}
          </small>
        </div>
        {group.map((item) => (
          <Link className="queue-row" to={item.href} key={`${item.kind}-${item.id}`}>
            <span className="queue-type">{item.kind}</span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.reason}</small>
            </span>
            <span className="queue-action">Review</span>
          </Link>
        ))}
      </div>
    );
  };
  const audienceCount = items.filter((item) => item.kind === 'Audience').length;
  const signalCount = items.filter((item) => item.kind === 'Signal').length;
  const draftCount = items.filter((item) => item.kind === 'Draft').length;
  const learningCount = items.filter((item) => item.kind === 'Learning').length;

  return (
    <section className="page-section today-page">
      <PageHeader
        eyebrow="Sales OS · Workspace"
        title="Today"
        purpose={`${items.length} decisions waiting. Nothing leaves Sales OS until you approve it.`}
        action={
          <div className="today-actions">
            <Link className="button-secondary" to="/sales-os/console">
              Ask Sales OS <kbd>⌘K</kbd>
            </Link>
          </div>
        }
      />
      {error && (
        <p className="error" role="alert">
          Unable to load today’s queue: {error}
        </p>
      )}
      <section className="loop-status card-surface" aria-label="Sales OS loop status">
        <div className="stage-row">
          <span className="field-label">1 · Product</span>
          <strong>{productCount ? 'Ready' : 'Not set up'}</strong>
          <small>
            {productCount
              ? `${productCount} product connected`
              : 'Add a product to begin'}
          </small>
        </div>
        <span className="stage-arrow">→</span>
        <div className="stage-row">
          <span className="field-label">2 · Audiences</span>
          <strong>{audienceCount}</strong>
          <small>{audienceCount ? 'to approve' : 'nothing to approve'}</small>
        </div>
        <span className="stage-arrow">→</span>
        <div className="stage-row stage-focus">
          <span className="field-label">
            3 · Signals {signalCount > 0 && <em>Most waiting</em>}
          </span>
          <strong>{signalCount}</strong>
          <small>{signalCount ? 'signals to review' : 'no signals to review'}</small>
        </div>
        <span className="stage-arrow">→</span>
        <div className="stage-row">
          <span className="field-label">4 · Engage</span>
          <strong>{draftCount}</strong>
          <small>{draftCount ? 'drafts ready to send' : 'no drafts ready'}</small>
        </div>
        <span className="stage-arrow">→</span>
        <div className="stage-row">
          <span className="field-label">5 · Learn</span>
          <strong>{learningCount}</strong>
          <small>{learningCount ? 'proposed change' : 'no proposed changes'}</small>
        </div>
        <p className="loop-status-note">
          ↻ &nbsp;Outcomes from Learn feed back into audiences, search and drafts after
          you approve them.
        </p>
      </section>
      <div className="today-grid">
        <section className="card-surface queue-panel">
          <div className="section-heading">
            <div>
              <span className="field-label">Waiting on you</span>
              <h3>
                {items.length ? `${items.length} decisions` : 'Nothing needs review'}
              </h3>
            </div>
            <span className="muted">Oldest first</span>
          </div>
          {items.length === 0 ? (
            <EmptyState title="No decisions are waiting. Add a product or approve an outreach decision to create the next step." />
          ) : (
            <div className="decision-queue">
              {renderGroup('Draft', 'Drafts ready')}
              {renderGroup('Signal', 'Signals')}
              {renderGroup('Audience', 'Audiences')}
              {renderGroup('Learning', 'Learnings')}
            </div>
          )}
        </section>
        <aside className="today-side">
          <section className="card-surface">
            <span className="field-label">Last 30 days</span>
            <div className="segment-control">
              <span className="selected">First touch</span>
              <span>Last touch</span>
            </div>
            <div className="today-metric">
              <strong>{metricCounts.replies}</strong>
              <span>Replies</span>
            </div>
            <div className="today-metric">
              <strong>{metricCounts.visits}</strong>
              <span>Visits</span>
            </div>
            <div className="today-metric">
              <strong>{metricCounts.signups}</strong>
              <span>Signups</span>
            </div>
            <div className="today-metric">
              <strong>{metricCounts.paid}</strong>
              <span>Paid</span>
            </div>
            <p className="muted">
              {metricCounts.replies || metricCounts.visits
                ? 'Attributed source details will appear as activity is recorded.'
                : 'No activity recorded yet.'}
            </p>
            <Link className="text-link" to="/sales-os/performance">
              View results
            </Link>
          </section>
          <section className="card-surface">
            <span className="field-label">Recently sent</span>
            {recentSent.length ? (
              recentSent.map((engagement) => (
                <div className="recent-row" key={engagement.id}>
                  <strong>
                    {engagement.subject ?? `${engagement.channel} engagement`}
                  </strong>
                  <small>{new Date(engagement.updated_at).toLocaleDateString()}</small>
                </div>
              ))
            ) : (
              <p className="muted">Nothing has been sent yet.</p>
            )}
            <Link className="text-link" to="/sales-os/engage">
              Open outreach
            </Link>
          </section>
          <StatusChip tone="success">
            {productCount} {productCount === 1 ? 'product' : 'products'} connected
          </StatusChip>
        </aside>
      </div>
    </section>
  );
}
