alter table public.sales_os_product_profiles
  add column if not exists display_labels jsonb not null default '{}'::jsonb;
alter table public.sales_os_icps
  add column if not exists display_labels jsonb not null default '{}'::jsonb;
alter table public.sales_os_audiences
  add column if not exists display_labels jsonb not null default '{}'::jsonb;
alter table public.sales_os_outreach_decisions
  add column if not exists display_labels jsonb not null default '{}'::jsonb;

comment on column public.sales_os_product_profiles.display_labels is 'UI-only short labels. Optional. Never read by workers or prompts.';
comment on column public.sales_os_icps.display_labels is 'UI-only short labels. Optional. Never read by workers or prompts.';
comment on column public.sales_os_audiences.display_labels is 'UI-only short labels. Optional. Never read by workers or prompts.';
comment on column public.sales_os_outreach_decisions.display_labels is 'UI-only short labels. Optional. Never read by workers or prompts.';
