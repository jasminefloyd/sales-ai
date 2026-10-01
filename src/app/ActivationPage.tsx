import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowserClient } from '../lib/supabase/browser';
import { activateAudience } from '../services/activation/activationService';

type Product = { id: string; name: string };
type Audience = { id: string; name: string; status: string };
type Destination = {
  id: string;
  name: string;
  destination_type: string;
  connector_key: string;
  status: string;
};
type Activation = {
  id: string;
  destination_name: string;
  status: string;
  sync_mode: string;
  last_error: string | null;
};

export function ActivationPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceId, setAudienceId] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [activations, setActivations] = useState<Activation[]>([]);
  const [destinationType, setDestinationType] = useState('csv');
  const [destinationName, setDestinationName] = useState('CSV export');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [mapping, setMapping] = useState(
    '{"email":"professional_email","company":"company_name","title":"title"}',
  );
  const [preview, setPreview] = useState<{
    total: number;
    eligibleCount: number;
    blockedCount: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (product = productId) => {
      if (!product) return;
      const [audienceResult, destinationResult, activationResult] = await Promise.all([
        supabaseBrowserClient
          .from('sales_os_audiences')
          .select('id,name,status')
          .eq('tenant_id', 'sales_os')
          .eq('product_id', product)
          .in('status', ['approved', 'active'])
          .order('created_at'),
        supabaseBrowserClient
          .from('sales_os_activation_destinations')
          .select('id,name,destination_type,connector_key,status')
          .eq('tenant_id', 'sales_os')
          .eq('product_id', product)
          .order('created_at'),
        supabaseBrowserClient
          .from('sales_os_audience_activations')
          .select('id,destination_name,status,sync_mode,last_error')
          .eq('tenant_id', 'sales_os')
          .eq('product_id', product)
          .order('created_at', { ascending: false }),
      ]);
      if (audienceResult.error || destinationResult.error || activationResult.error)
        throw audienceResult.error ?? destinationResult.error ?? activationResult.error;
      setAudiences((audienceResult.data ?? []) as Audience[]);
      setAudienceId((current) => current || audienceResult.data?.[0]?.id || '');
      setDestinations((destinationResult.data ?? []) as Destination[]);
      setDestinationId((current) => current || destinationResult.data?.[0]?.id || '');
      setActivations((activationResult.data ?? []) as Activation[]);
    },
    [productId],
  );

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
    if (productId)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load().catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : 'Unable to load activation data.',
        ),
      );
  }, [load, productId]);

  async function connect() {
    setError(null);
    setMessage(null);
    try {
      await activateAudience({
        action: 'connect',
        productId,
        destinationType,
        name: destinationName,
        endpointUrl: endpointUrl || undefined,
        secretRef: secretRef || undefined,
        connectorKey: destinationType === 'crm' ? 'hubspot' : 'generic',
      });
      setMessage('Destination connected.');
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to connect destination.',
      );
    }
  }
  async function create() {
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(mapping) as Record<string, unknown>;
      const result = await activateAudience({
        action: 'create',
        productId,
        audienceId,
        destinationId,
        fieldMapping: parsed,
      });
      setMessage(`Activation ${result.data?.id ?? ''} is awaiting approval.`);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to create activation.',
      );
    }
  }
  async function run(action: 'approve' | 'sync' | 'retry', activationId: string) {
    setError(null);
    setMessage(null);
    try {
      await activateAudience({ action, activationId });
      setMessage(
        action === 'approve'
          ? 'Activation approved and queued.'
          : 'Activation sync queued.',
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to update activation.',
      );
    }
  }
  async function showPreview() {
    setError(null);
    try {
      const result = await activateAudience({
        action: 'preview',
        productId,
        audienceId,
        definitionId: '',
      });
      setPreview(result.preview);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to preview audience.',
      );
    }
  }

  return (
    <section className="page-section">
      <p className="eyebrow">Activation</p>
      <h2>Human-approved audience activation</h2>
      <p className="muted">
        Review readiness, connect a destination, preview the records, then approve each
        sync.
      </p>
      <div className="panel stack">
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
          Approved audience
          <select
            value={audienceId}
            onChange={(event) => setAudienceId(event.target.value)}
          >
            {audiences.map((audience) => (
              <option key={audience.id} value={audience.id}>
                {audience.name}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void showPreview()}>
            Preview readiness
          </button>
          {preview && (
            <span className="muted">
              {preview.eligibleCount} eligible / {preview.blockedCount} blocked of{' '}
              {preview.total}
            </span>
          )}
        </div>
      </div>
      <div className="panel stack">
        <h3>Destinations</h3>
        <div className="form-grid">
          <label>
            Type
            <select
              value={destinationType}
              onChange={(event) => setDestinationType(event.target.value)}
            >
              <option value="csv">CSV download</option>
              <option value="webhook">Webhook</option>
              <option value="crm">HubSpot CRM</option>
            </select>
          </label>
          <label>
            Name
            <input
              value={destinationName}
              onChange={(event) => setDestinationName(event.target.value)}
            />
          </label>
          {destinationType !== 'csv' && (
            <>
              <label>
                Endpoint URL
                <input
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label>
                Secret reference
                <input
                  value={secretRef}
                  onChange={(event) => setSecretRef(event.target.value)}
                  placeholder="SALES_OS_HUBSPOT_TOKEN"
                />
              </label>
            </>
          )}
        </div>
        <button type="button" onClick={() => void connect()}>
          Connect destination
        </button>
        {destinations.map((destination) => (
          <div className="list-row" key={destination.id}>
            <span>
              <strong>{destination.name}</strong> · {destination.destination_type} ·{' '}
              {destination.status}
            </span>
          </div>
        ))}
      </div>
      <div className="panel stack">
        <h3>Prepare activation</h3>
        <p className="muted">Choose which contact fields to include in your export or sync.</p>
        <div className="form-grid">
          {['email','company','title'].map(field=>(
            <label key={field}>
              {field === 'email' ? 'Email address' : field === 'company' ? 'Organization' : 'Job title'}
              <select value={(() => {try {return String(JSON.parse(mapping)[field] ?? '');} catch {return '';}})()}
                onChange={event=>{let current:Record<string,unknown>={};try {current=JSON.parse(mapping);} catch { /* Replace invalid advanced JSON with valid chosen fields. */ }setMapping(JSON.stringify({...current,[field]:event.target.value}));}}>
                <option value="">Not included</option>
                <option value="professional_email">Professional email</option>
                <option value="company_name">Organization name</option>
                <option value="full_name">Contact name</option>
                <option value="title">Job title</option>
              </select>
            </label>
          ))}
        </div>
        <details>
          <summary>Advanced field mapping</summary>
          <label>
          Field mapping JSON
          <textarea
            value={mapping}
            onChange={(event) => setMapping(event.target.value)}
            rows={4}
          />
        </label>
        </details>
        <label>
          Destination
          <select
            value={destinationId}
            onChange={(event) => setDestinationId(event.target.value)}
          >
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name} · {destination.destination_type}
              </option>
            ))}
          </select>
        </label>
        {(!destinationId || !audienceId) && <p className="muted">Select an approved audience and connect a destination before requesting approval.</p>}
        <button
          type="button"
          disabled={!destinationId || !audienceId}
          onClick={() => void create()}
        >
          Request approval
        </button>
      </div>
      <div className="panel stack">
        <h3>Activation review</h3>
        {activations.length === 0 && (
          <p className="muted">No activation requests yet.</p>
        )}
        {activations.map((activation) => (
          <div className="list-row" key={activation.id}>
            <span>
              <strong>{activation.destination_name}</strong> · {activation.status}
              {activation.last_error ? ` · ${activation.last_error}` : ''}
            </span>
            <span className="button-row">
              {activation.status === 'pending_approval' && (
                <button
                  type="button"
                  onClick={() => void run('approve', activation.id)}
                >
                  Approve
                </button>
              )}
              {['approved', 'failed'].includes(activation.status) && (
                <button
                  type="button"
                  onClick={() =>
                    void run(
                      activation.status === 'failed' ? 'retry' : 'sync',
                      activation.id,
                    )
                  }
                >
                  {activation.status === 'failed' ? 'Retry' : 'Sync'}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
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
