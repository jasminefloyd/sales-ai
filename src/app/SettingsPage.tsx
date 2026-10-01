import { useEffect, useState } from 'react';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { updateSalesOsSettings } from '../services/settings/settingsService';

type Product = {
  id: string;
  name: string;
};
type Provider = {
  id: string;
  display_name: string;
  provider_key: string;
  capability: string;
  enabled: boolean;
  priority: number;
};
type ChannelAccount = {
  id: string;
  product_id: string | null;
  platform: string;
  external_account_id: string;
  display_label: string;
  enabled: boolean;
};
type Setting = {
  product_id: string;
  setting_key: string;
  value: Record<string, unknown>;
};

export function SettingsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [productId, setProductId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [productResult, providerResult, accountResult, settingResult] =
      await Promise.all([
        supabaseBrowserClient
          .from('sales_os_products')
          .select('id, name')
          .eq('tenant_id', 'sales_os')
          .order('name'),
        supabaseBrowserClient
          .from('sales_os_providers')
          .select('id, display_name, provider_key, capability, enabled, priority')
          .eq('tenant_id', 'sales_os')
          .order('priority'),
        supabaseBrowserClient
          .from('sales_os_channel_accounts')
          .select(
            'id, product_id, platform, external_account_id, display_label, enabled',
          )
          .eq('tenant_id', 'sales_os')
          .order('display_label'),
        supabaseBrowserClient
          .from('sales_os_operating_settings')
          .select('product_id, setting_key, value')
          .eq('tenant_id', 'sales_os'),
      ]);
    const failure = [productResult, providerResult, accountResult, settingResult].find(
      (result) => result.error,
    );
    if (failure?.error) setError(failure.error.message);
    else {
      setProducts((productResult.data ?? []) as Product[]);
      setProviders((providerResult.data ?? []) as Provider[]);
      setAccounts((accountResult.data ?? []) as ChannelAccount[]);
      setSettings((settingResult.data ?? []) as Setting[]);
      if (!productId && productResult.data?.[0]) setProductId(productResult.data[0].id);
    }
  }
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleProvider(provider: Provider) {
    try {
      await updateSalesOsSettings({
        action: 'update_provider',
        providerId: provider.id,
        enabled: !provider.enabled,
      });
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Unable to update provider.',
      );
    }
  }

  return (
    <section className="page-section">
      <p className="eyebrow">Workspace settings</p>
      <h2>Settings</h2>
      <p className="muted">
        Manage channels, AI availability, attribution, and learning configuration.
        Credentials remain server-side.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="panel stack">
        <h3>AI and channel availability</h3>
        <p className="muted">Enabled allows a service to be used. It does not confirm credentials, available credits, or a successful connection.</p>
        {providers.filter(provider=>provider.provider_key !== 'posthog').map((provider) => (
          <div className="route-row" key={provider.id}>
            <span>
              <strong>{provider.display_name}</strong>
              <br />
              <span className="muted">{provider.capability.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ')} · {provider.enabled ? 'Enabled · connection not verified' : 'Disabled'}</span>
            </span>
            <button
              className={provider.enabled ? '' : 'button-secondary'}
              onClick={() => void toggleProvider(provider)}
            >
              {provider.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
      <div className="panel stack">
        <h3>Configured branded channels</h3>
        {accounts.length === 0 ? (
          <p className="muted">No branded channel accounts configured.</p>
        ) : (
          accounts.map((account) => (
            <div className="route-row" key={account.id}>
              <span>
                {account.display_label} · {account.platform} ·{' '}
                {account.external_account_id}
              </span>
              <span className="status-pill">
                {account.enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="panel stack">
        <h3>Evidence and attribution settings</h3>
        <label>
          Product
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        {settings
          .filter((setting) => setting.product_id === productId)
          .map((setting) => (
            <div className="route-row" key={setting.setting_key}>
              <span>{setting.setting_key}</span>
              <code>{JSON.stringify(setting.value)}</code>
            </div>
          ))}
        {productId &&
          settings.filter((setting) => setting.product_id === productId).length ===
            0 && <p className="muted">No product-specific settings configured yet.</p>}
      </div>
    </section>
  );
}
