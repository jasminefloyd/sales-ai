import { useEffect, useState } from 'react';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { reviewLearning } from '../services/learning/reviewService';
import { requestLearningAnalysis } from '../services/learning/runLearningService';
import { displayStatus } from './status';

type Learning = {
  id: string;
  product_id: string;
  observation: string;
  supporting_evidence: unknown[];
  sample_size: number;
  confidence: string;
  recommended_change: { targetKey?: string; before?: unknown; after?: unknown };
  target_phase: string;
  status: string;
};

export function LearningPage() {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [productId, setProductId] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  async function load() {
    const { data, error: queryError } = await supabaseBrowserClient
      .from('sales_os_learnings')
      .select(
        'id, product_id, observation, supporting_evidence, sample_size, confidence, recommended_change, target_phase, status',
      )
      .eq('tenant_id', 'sales_os')
      .in('status', [
        'detected',
        'proposed',
        'approved',
        'active',
        'rejected',
        'superseded',
      ])
      .order('created_at', { ascending: false });
    if (queryError) setError(queryError.message);
    else setLearnings((data ?? []) as Learning[]);
  }

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
    void supabaseBrowserClient
      .from('sales_os_products')
      .select('id,name')
      .eq('tenant_id', 'sales_os')
      .order('name')
      .then(({ data, error: productError }) => {
        if (productError) setError(productError.message);
        else {
          const next = (data ?? []) as Array<{ id: string; name: string }>;
          setProducts(next);
          if (next[0]) setProductId(next[0].id);
        }
      });
  }, []);

  async function runAnalysis() {
    if (!productId) return;
    setError(null);
    setIsRunning(true);
    try {
      await requestLearningAnalysis({ productId });
      await load();
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : 'Learning analysis failed.',
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function review(learningId: string, action: 'approve' | 'reject') {
    try {
      await reviewLearning({ learningId, action });
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'Learning review failed.',
      );
    }
  }

  return (
    <section className="page-section">
      <p className="eyebrow">Learnings</p>
      <h2>Learning proposals</h2>
      <p className="muted">
        Every recommendation shows its evidence and exact target before application.
      </p>
      <div className="panel button-row">
        <label>
          Product
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Select a product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!productId || isRunning} onClick={() => void runAnalysis()}>
          {isRunning ? 'Analyzing…' : 'Run learning analysis'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {learnings.length === 0 ? (
        <div className="empty-state">No learning proposals are available.</div>
      ) : (
        learnings.map((learning) => (
          <article className="panel opportunity-card" key={learning.id}>
            <div className="card-heading">
              <div>
                <h3>{learning.observation}</h3>
                <span className="muted">
                  {displayStatus(learning.status)} ·{' '}
                  {displayStatus(learning.target_phase)}
                </span>
              </div>
              <span className="status-pill">{learning.confidence}</span>
            </div>
            <p>
              <strong>Evidence:</strong> {learning.supporting_evidence.length} records ·
              sample size {learning.sample_size}
            </p>
            <p>
              <strong>Target:</strong>{' '}
              {learning.recommended_change.targetKey ?? 'Not specified'}
            </p>
            <p>
              <strong>Before:</strong>{' '}
              {JSON.stringify(learning.recommended_change.before)}{' '}
              <strong>After:</strong>{' '}
              {JSON.stringify(learning.recommended_change.after)}
            </p>
            {['detected', 'proposed'].includes(learning.status) && (
              <div className="button-row">
                <button onClick={() => void review(learning.id, 'approve')}>
                  Approve + apply
                </button>
                <button
                  className="button-secondary"
                  onClick={() => void review(learning.id, 'reject')}
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
}
