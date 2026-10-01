import { useEffect, useState } from 'react';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { parseConsoleCommand } from '../services/console/consoleCommands';
import { executeConsoleRequest } from '../services/console/reviewService';

type Product = { id: string; name: string };

export function ConsolePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [command, setCommand] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabaseBrowserClient
      .from('sales_os_products')
      .select('id, name')
      .eq('tenant_id', 'sales_os')
      .order('name')
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        else {
          const next = (data ?? []) as Product[];
          setProducts(next);
          if (next[0]) setProductId(next[0].id);
        }
      });
  }, []);

  async function submit() {
    if (!productId || !command.trim()) return;
    setError(null);
    try {
      const parsed = parseConsoleCommand(command, productId);
      const response = await executeConsoleRequest({
        tool: parsed.tool,
        productId,
        entityId: parsed.input.entityId,
        payload: parsed.input,
      });
      setResult(response);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Console request failed.',
      );
    }
  }

  return (
    <section className="page-section">
      <p className="eyebrow">Ask Sales OS</p>
      <h2>Ask Sales OS</h2>
      <p className="muted">
        Read requests query canonical Sales OS state. State-changing requests create
        pending approvals and never update records directly.
      </p>
      <div className="panel stack">
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
        <label>
          Request
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder="What have we learned this month?"
          />
        </label>
        <p className="muted">
          Examples: “show high-intent opportunities”, “what have we learned this
          month?”, “run find”, “reject opportunity &lt;id&gt;”, “stop targeting acting
          schools”.
        </p>
        <button onClick={() => void submit()} disabled={!productId || !command.trim()}>
          Run request
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result !== null && (
        <pre className="panel console-result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  );
}
