-- Ensure Anthropic is always available as the second reasoning provider.
-- OpenAI remains first; the worker falls through to Anthropic when the first
-- provider is unavailable, misconfigured, rate-limited, or otherwise retryable.

insert into public.sales_os_providers (
  tenant_id,
  capability,
  provider_key,
  display_name,
  enabled,
  priority,
  configuration,
  pricing_metadata,
  created_by,
  updated_by
)
values (
  'sales_os',
  'reasoning',
  'anthropic',
  'Anthropic',
  true,
  200,
  '{}'::jsonb,
  '{}'::jsonb,
  'system:migration',
  'system:migration'
)
on conflict (tenant_id, capability, provider_key)
do update set
  display_name = excluded.display_name,
  enabled = true,
  priority = 200,
  updated_by = 'system:migration',
  updated_at = now();
