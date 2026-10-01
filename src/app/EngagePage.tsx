import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabaseBrowserClient } from '../lib/supabase/browser';
import {
  completeManualEngagement,
  reviewEngagement,
  type EngagementReviewAction,
} from '../services/engagement/reviewService';
import {
  AIAssessment,
  DeterministicChecks,
  EmptyState,
  PageHeader,
} from './designSystem';
import { displayStatus } from './status';

type Engagement = {
  id: string;
  product_id: string;
  audience_id: string | null;
  opportunity_id: string | null;
  contact_id: string | null;
  channel: string;
  objective: string | null;
  subject: string | null;
  status: string;
  message_angle: string | null;
  cta: string | null;
  evidence_context: unknown[];
  why_engage: string | null;
  follow_up_strategy: Record<string, unknown>;
  risk_sensitivity: string | null;
  suppression_check: Record<string, unknown>;
  draft_content: string;
  final_content: string | null;
  created_at: string;
};
type Conversation = {
  product_id: string;
  opportunity_id: string;
  status: string;
  last_activity_at: string;
};

export function EngagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [productId, setProductId] = useState(searchParams.get('product') ?? '');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [audienceNames, setAudienceNames] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void supabaseBrowserClient
      .from('sales_os_products')
      .select('id, name')
      .eq('tenant_id', 'sales_os')
      .order('created_at', { ascending: false })
      .then(({ data, error: productError }) => {
        if (!active) return;
        if (productError) {
          setError(productError.message);
          return;
        }
        const rows = (data ?? []) as Array<{ id: string; name: string }>;
        setProducts(rows);
        const requested = searchParams.get('product');
        const selected = rows.some((row) => row.id === requested)
          ? requested!
          : (rows[0]?.id ?? '');
        setProductId(selected);
        if (selected && selected !== requested)
          setSearchParams({ product: selected }, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [searchParams, setSearchParams]);
  async function load() {
    if (!productId) {
      setEngagements([]);
      setConversations([]);
      return;
    }
    const [
      { data, error: queryError },
      { data: conversationData, error: conversationError },
      { data: audienceData, error: audienceError },
    ] = await Promise.all([
      supabaseBrowserClient
        .from('sales_os_engagements')
        .select(
          'id, product_id, audience_id, opportunity_id, contact_id, channel, objective, subject, status, message_angle, cta, evidence_context, why_engage, follow_up_strategy, risk_sensitivity, suppression_check, draft_content, final_content, created_at',
        )
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('created_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_conversations')
        .select('product_id, opportunity_id, status, last_activity_at')
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId)
        .order('last_activity_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_audiences')
        .select('id, name')
        .eq('tenant_id', 'sales_os')
        .eq('product_id', productId),
    ]);
    if (queryError || conversationError || audienceError)
      setError(
        (queryError ?? conversationError ?? audienceError)?.message ??
          'Unable to load engagement state.',
      );
    else {
      setEngagements((data ?? []) as Engagement[]);
      setConversations((conversationData ?? []) as Conversation[]);
      setAudienceNames(
        Object.fromEntries(
          (audienceData ?? []).map((audience) => [audience.id, audience.name]),
        ),
      );
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // The loader intentionally captures the current product selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  async function review(id: string, action: EngagementReviewAction) {
    try {
      await reviewEngagement({
        engagementId: id,
        action,
        finalContent: action === 'edit_approve' ? edits[id] : undefined,
      });
      setEditingId(null);
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Engagement review failed.',
      );
    }
  }
  function beginEdit(engagement: Engagement) {
    setEdits((current) => ({
      ...current,
      [engagement.id]:
        current[engagement.id] ?? engagement.final_content ?? engagement.draft_content,
    }));
    setEditingId(engagement.id);
  }
  async function completeManual(id: string) {
    try {
      await completeManualEngagement({ engagementId: id });
      await load();
    } catch (completionError) {
      setError(
        completionError instanceof Error
          ? completionError.message
          : 'Manual engagement completion failed.',
      );
    }
  }
  const selected =
    engagements.find((engagement) => engagement.id === selectedId) ??
    engagements[0] ??
    null;
  const conversation = selected
    ? conversations.find(
        (item) =>
          item.product_id === selected.product_id &&
          item.opportunity_id === selected.opportunity_id,
      )
    : null;
  const selectedProduct = products.find((product) => product.id === productId);
  return (
    <section className="page-section outreach-page">
      <PageHeader
        eyebrow="Engage"
        title="Generated copy"
        purpose={`${selectedProduct?.name ?? 'Your product'} · ${engagements.length} drafts for review.`}
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
          }}
        >
          {products.length === 0 && <option value="">No products</option>}
          {products.map((product) => (
            <option value={product.id} key={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!selected ? (
        <EmptyState title="No engagement drafts are awaiting review." />
      ) : (
        <div className="outreach-layout">
          <div className="outreach-list">
            {engagements.map((engagement) => (
              <button
                type="button"
                className={`outreach-list-item ${selected.id === engagement.id ? 'selected' : ''}`}
                key={engagement.id}
                onClick={() => setSelectedId(engagement.id)}
              >
                <span className="field-label">{engagement.channel}</span>
                <strong>
                  {engagement.subject || audienceNames[engagement.audience_id ?? ''] || 'Product audience'}
                </strong>
                <small>{displayStatus(engagement.status)}</small>
                {engagement.channel === 'email' && !engagement.contact_id && (
                  <small>Audience template · no recipient selected</small>
                )}
              </button>
            ))}
          </div>
          <article className="signal-detail card-surface">
            <div className="detail-topline">
              <span>
                {selected.channel} · {displayStatus(selected.status)}
              </span>
              <span className="status-pill">Needs your approval</span>
            </div>
            <h3>
              {audienceNames[selected.audience_id ?? ''] ?? 'Product audience'} · Review
              copy
            </h3>
            {conversation && (
              <p className="muted">
                Conversation · {displayStatus(conversation.status)} · last activity{' '}
                {conversation.last_activity_at}
              </p>
            )}
            <span className="field-label">Why we’re engaging</span>
            <p>
              {selected.why_engage ??
                selected.objective ??
                'Review the evidence and strategy before approving.'}
            </p>
            <span className="field-label">What shaped this draft</span>
            <div className="draft-context">
              <span>Audience</span>
              <strong>
                {audienceNames[selected.audience_id ?? ''] ?? 'Product audience'}
              </strong>
              <span>Angle</span>
              <strong>
                {selected.message_angle ?? 'Helpful first, product second'}
              </strong>
              <span>CTA</span>
              <strong>{selected.cta ?? 'See the product'}</strong>
            </div>
            <AIAssessment>
              Helpful first, product second. The draft uses the observed signal and
              keeps the product claim proportional to the evidence.
            </AIAssessment>
            <label>
              <span className="field-label">
                Your {selected.channel === 'email' ? 'email' : 'reply'}
              </span>
              <textarea
                rows={10}
                disabled={editingId !== selected.id}
                value={
                  edits[selected.id] ?? selected.final_content ?? selected.draft_content
                }
                onChange={(event) =>
                  setEdits((current) => ({
                    ...current,
                    [selected.id]: event.target.value,
                  }))
                }
              />
            </label>
            <DeterministicChecks
              checks={[
                { label: 'Evidence', passed: selected.evidence_context.length > 0 },
                {
                  label: 'Not suppressed',
                  passed: selected.suppression_check.checked === true && selected.suppression_check.result === 'passed',
                },
              ]}
            />
            <div className="button-row detail-actions">
              {selected.status === 'awaiting_approval' &&
                (editingId === selected.id ? (
                  <button onClick={() => void review(selected.id, 'edit_approve')}>
                    {selected.channel === 'email'
                      ? 'Approve edited email'
                      : 'Approve edited post'}
                  </button>
                ) : (
                  <button onClick={() => void review(selected.id, 'approve')}>
                    {selected.channel === 'email'
                      ? 'Approve email copy'
                      : 'Approve copy'}
                  </button>
                ))}
              {selected.status === 'awaiting_approval' &&
                (editingId === selected.id ? (
                  <button
                    className="button-secondary"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel edit
                  </button>
                ) : (
                  <button
                    className="button-secondary"
                    onClick={() => beginEdit(selected)}
                  >
                    Edit draft
                  </button>
                ))}
              <button
                className="button-quiet"
                onClick={() => void review(selected.id, 'reject')}
              >
                Reject
              </button>
            </div>
            {selected.channel !== 'email' && selected.status === 'queued' && (
              <button onClick={() => void completeManual(selected.id)}>
                Mark manual completion
              </button>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
