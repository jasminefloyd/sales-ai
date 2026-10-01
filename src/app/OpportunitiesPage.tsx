import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import {
  reviewOpportunity,
  type OpportunityReviewAction,
} from '../services/discovery/reviewService';
import {
  AIAssessment,
  DeterministicChecks,
  EmptyState,
  EvidenceMeter,
  PageHeader,
} from './designSystem';
import { displayRoute, displayStatus } from './status';

type Opportunity = {
  id: string;
  product_id: string;
  audience_id: string;
  source_id: string;
  signal_id: string | null;
  route_type: string;
  title: string;
  summary: string;
  evidence: Array<{ url?: string; excerpt?: string; sourceType?: string }>;
  evidence_score: string;
  evidence_score_detail: Record<string, unknown>;
  signal_type: string | null;
  fit_score: number | null;
  qualification_reason: string | null;
  suppression_checked: boolean;
  ai_fit_assessment: string;
  recommended_action: string;
  status: string;
  discovered_at: string;
};

export function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [productId, setProductId] = useState(searchParams.get('product') ?? '');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [audienceNames, setAudienceNames] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audienceFilter, setAudienceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [routeFilter, setRouteFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);

  async function load() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    const productResult = await supabaseBrowserClient
        .from('sales_os_products')
        .select('id, name')
        .eq('tenant_id', 'sales_os')
        .order('created_at', { ascending: false });
    if (version !== requestVersion.current) return;
    if (productResult.error) {
      setError('Unable to load products. Please retry.');
      setLoading(false);
      return;
    }
    const productRows = (productResult.data ?? []) as Array<{ id: string; name: string }>;
    setProducts(productRows);
    const requested = searchParams.get('product');
    const nextProduct = productRows.find((product) => product.id === requested)?.id ?? productRows[0]?.id ?? '';
    setProductId(nextProduct);
    if (!nextProduct) {
      setOpportunities([]);
      setAudienceNames({});
      setLoading(false);
      return;
    }
    if (requested !== nextProduct) {
      const params = new URLSearchParams(searchParams);
      params.set('product', nextProduct);
      setSearchParams(params, { replace: true });
      return;
    }
    const [opportunityResult, audienceResult] = await Promise.all([
      supabaseBrowserClient
        .from('sales_os_opportunities')
        .select(
          'id, product_id, audience_id, source_id, signal_id, route_type, title, summary, evidence, evidence_score, evidence_score_detail, signal_type, fit_score, qualification_reason, suppression_checked, ai_fit_assessment, recommended_action, status, discovered_at',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', nextProduct)
        .order('discovered_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_audiences')
        .select('id, name')
        .eq('tenant_id', 'sales_os')
        .eq('product_id', nextProduct),
    ]);
    if (version !== requestVersion.current) return;
    setLoading(false);
    if (productResult.error || opportunityResult.error || audienceResult.error) {
      setError(
        (productResult.error ?? opportunityResult.error ?? audienceResult.error)
          ?.message ?? 'Unable to load signals.',
      );
      return;
    }
    setOpportunities((opportunityResult.data ?? []) as Opportunity[]);
    setAudienceNames(
      Object.fromEntries(
        (audienceResult.data ?? []).map((audience) => [audience.id, audience.name]),
      ),
    );
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { requestVersion.current += 1; };
    // The loader intentionally captures the current product selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  async function review(id: string, action: OpportunityReviewAction) {
    try {
      await reviewOpportunity({ opportunityId: id, action });
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'Review action failed.',
      );
    }
  }
  function skipSelected() {
    if (!selected) return;
    const index = filtered.findIndex((item) => item.id === selected.id);
    setSelectedId(filtered[(index + 1) % filtered.length]?.id ?? null);
  }

  const filtered = opportunities.filter(
    (item) =>
      (audienceFilter === 'all' || item.audience_id === audienceFilter) &&
      (statusFilter === 'all' || item.status === statusFilter) &&
      (scoreFilter === 'all' || item.evidence_score === scoreFilter || (scoreFilter === 'medium' && item.evidence_score === 'high')) &&
      (routeFilter === 'all' || item.route_type === routeFilter),
  );
  const selected =
    filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        if (!filtered.length) return;
        const index = filtered.findIndex((item) => item.id === selected?.id);
        const nextIndex =
          key === 'j'
            ? (index + 1) % filtered.length
            : (index - 1 + filtered.length) % filtered.length;
        setSelectedId(filtered[nextIndex].id);
      }
      if (key === 'a' && selected) void review(selected.id, 'request_draft');
      if (key === 's') skipSelected();
      if (key === 'x' && selected) void review(selected.id, 'reject');
    }
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
    // The handlers intentionally use the current filtered selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selected]);

  return (
    <section className="page-section signals-page">
      <PageHeader
        eyebrow="Product signals"
        title="Signals"
        purpose="Review contacts and community signals before drafting outreach."
        action={
          <span className="keyboard-hint">
            <kbd>J</kbd>
            <kbd>K</kbd> move <kbd>A</kbd> draft <kbd>S</kbd> skip <kbd>X</kbd> not like
            this
          </span>
        }
      />
      <label className="filter-row">
        Product
        <select
          value={productId}
          onChange={(event) => {
            const next = event.target.value;
            setProductId(next);
            setSearchParams(next ? { product: next } : {}, { replace: true });
            setSelectedId(null);
            setAudienceFilter('all');
            setOpportunities([]);
          }}
        >
          {products.length === 0 && <option value="">{loading ? 'Loading products…' : error ? 'Products unavailable' : 'No products'}</option>}
          {products.map((product) => (
            <option value={product.id} key={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <div className="filter-row compact-filters">
        <label>
          Audience
          <select
            value={audienceFilter}
            onChange={(event) => setAudienceFilter(event.target.value)}
          >
            <option value="all">All approved</option>
            {Object.entries(audienceNames).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Route
          <select
            value={routeFilter}
            onChange={(event) => setRouteFilter(event.target.value)}
          >
            <option value="all">Social + Direct</option>
            <option value="social">Social</option>
            <option value="direct">Direct</option>
          </select>
        </label>
        <label>
          Evidence
          <select
            value={scoreFilter}
            onChange={(event) => setScoreFilter(event.target.value)}
          >
            <option value="all">All evidence</option>
            <option value="high">High and up</option>
            <option value="medium">Medium and up</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All status</option>
            <option value="awaiting_review">Awaiting review</option>
            <option value="approved">Approved</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? <p role="status">Loading signals…</p> : error ? (
        <button className="button-secondary" onClick={() => void load()}>Retry</button>
      ) : !selected ? (
        <EmptyState title={products.length ? 'No signals match the selected filters.' : 'Add a product to discover signals.'} />
      ) : (
        <div className="split-view">
          <div className="signal-list">
            <div className="list-summary">
              {filtered.length} signals · sorted by evidence
            </div>
            {filtered.map((item) => (
              <button
                className={`signal-list-item ${selected.id === item.id ? 'selected' : ''}`}
                type="button"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="signal-meta">
                  {displayRoute(item.route_type)} · {displayStatus(item.status)}
                </span>
                <EvidenceMeter
                  level={item.evidence_score as 'low' | 'medium' | 'high'}
                />
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
              </button>
            ))}
          </div>
          <article className="signal-detail card-surface">
            <div className="detail-topline">
              <span>
                {displayRoute(selected.route_type)} ·{' '}
                {new Date(selected.discovered_at).toLocaleString()}
              </span>
              <EvidenceMeter
                level={selected.evidence_score as 'low' | 'medium' | 'high'}
              />
            </div>
            <h3>{selected.title}</h3>
            <span className="field-label">Why it surfaced</span>
            <p>{selected.summary}</p>
            <span className="field-label">Signal</span>
            <p className="signal-quote">
              {selected.evidence[0]?.excerpt ?? selected.title}
            </p>
            <span className="field-label">Recommended action</span>
            <p>{selected.recommended_action}</p>
            <AIAssessment>{selected.ai_fit_assessment}</AIAssessment>
            <DeterministicChecks
              checks={[
                { label: 'Source retained', passed: selected.evidence.length > 0 },
                { label: 'Suppression checked', passed: selected.suppression_checked },
                { label: 'Audience mapped', passed: true },
              ]}
            />
            <details>
              <summary>View original evidence</summary>
              <div className="evidence-list">
                {selected.evidence.map((evidence, index) => (
                  <div key={`${evidence.url ?? 'evidence'}-${index}`}>
                    <strong>{evidence.sourceType ?? 'Source'}</strong>:{' '}
                    {evidence.excerpt}{' '}
                    {evidence.url && (
                      <a href={evidence.url} target="_blank" rel="noreferrer">
                        Open source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </details>
            <div className="button-row detail-actions">
              <button onClick={() => void review(selected.id, 'request_draft')}>
                {selected.route_type === 'direct' ? 'Draft email' : 'Draft reply'}
              </button>
              <button
                className="button-secondary"
                onClick={() => void review(selected.id, 'reject')}
              >
                Not like this
              </button>
              <button className="button-quiet" onClick={skipSelected}>
                Skip
              </button>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
