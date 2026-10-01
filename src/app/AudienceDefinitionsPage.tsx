import { useEffect, useState } from 'react';
import {Link} from 'react-router-dom';
import { supabaseBrowserClient } from '../lib/supabase/browser';
import { refreshAudienceDefinition } from '../services/audience/reusableAudienceService';

type Product = { id: string; name: string };
type Definition = {
  id: string;
  audience_id: string;
  name: string;
  version: number;
  status: string;
  rule_definition: Record<string, unknown>;
  freshness_at: string;
  updated_at: string;
};

export function AudienceDefinitionsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load(product = productId) {
    if (!product) return;
    const { data, error: loadError } = await supabaseBrowserClient
      .from('sales_os_audience_definitions')
      .select(
        'id,audience_id,name,version,status,rule_definition,freshness_at,updated_at',
      )
      .eq('tenant_id', 'sales_os')
      .eq('product_id', product)
      .order('updated_at', { ascending: false });
    if (loadError) throw loadError;
    setDefinitions((data ?? []) as Definition[]);
  }
  useEffect(() => {
    void supabaseBrowserClient
      .from('sales_os_products')
      .select('id,name')
      .eq('tenant_id', 'sales_os')
      .order('created_at')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        const rows = (data ?? []) as Product[];
        setProducts(rows);
        setProductId(rows[0]?.id ?? '');
      });
  }, []);
  useEffect(() => {
    if (productId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load().catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : 'Unable to load definitions.',
        ),
      );
    }
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function preview(definition: Definition) {
    try {
      const result = await refreshAudienceDefinition({
        action: 'preview',
        productId,
        definitionId: definition.id,
      });
      setMessage(
        `${definition.name} v${definition.version}: ${result.preview?.matching ?? 0} matching of ${result.preview?.total ?? 0}; ${result.preview?.wouldRemove ?? 0} would be removed.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Preview failed.');
    }
  }
  async function refresh(definition: Definition) {
    try {
      const result = await refreshAudienceDefinition({
        action: 'refresh',
        productId,
        definitionId: definition.id,
      });
      setMessage(`Refresh queued${result.jobId ? ` (${result.jobId})` : ''}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Refresh failed.');
    }
  }
  return (
    <section className="page-section">
      <p className="eyebrow">Audience definitions</p>
      <h2>Reusable audiences</h2>
      <p className="muted">
        Versioned rules can be previewed and refreshed without rebuilding the audience
        strategy.
      </p>
      <div className="panel">
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
      </div>
      {definitions.map((definition) => (
        <article className="panel stack" key={definition.id}>
          <div className="button-row">
            <h3>
              {definition.name} · v{definition.version}
            </h3>
            <span className="status-pill">{definition.status}</span>
          </div>
          <p className="muted">
            Last refreshed {new Date(definition.freshness_at).toLocaleString()}
          </p>
          <details>
            <summary>View rule document</summary>
            <pre>{JSON.stringify(definition.rule_definition, null, 2)}</pre>
          </details>
          <div className="button-row">
            <button type="button" onClick={() => void preview(definition)}>
              Preview rules
            </button>
            <button type="button" onClick={() => void refresh(definition)}>
              Refresh membership
            </button>
          </div>
        </article>
      ))}
      {!definitions.length && (
        <p className="empty-state">
          No reusable definitions are available for this product yet. Review an audience in the product workflow to create its targeting definition.{' '}
          {productId && <Link to={`/sales-os/products/${productId}?step=audiences`}>Review audiences</Link>}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
