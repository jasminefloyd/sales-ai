-- Sales OS provider definitions only. No products, contacts, leads, or
-- opportunities are seeded here.
insert into public.sales_os_providers
  (tenant_id, capability, provider_key, display_name, enabled, priority, configuration, pricing_metadata, created_by, updated_by)
values
  ('sales_os', 'reasoning', 'openai', 'OpenAI', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'reasoning', 'anthropic', 'Anthropic', false, 200, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'search_web', 'exa', 'Exa', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'scrape_page', 'firecrawl', 'Firecrawl', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'find_contact', 'hunter', 'Hunter', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'send_email', 'gmail', 'Gmail', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'search_community', 'reddit_web', 'Reddit / Web discovery', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'publish_response', 'community', 'Supported community publisher', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'get_product_event', 'posthog', 'PostHog', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed'),
  ('sales_os', 'get_revenue_event', 'stripe', 'Stripe', false, 100, '{}'::jsonb, '{}'::jsonb, 'seed', 'seed')
on conflict (tenant_id, capability, provider_key) do nothing;
