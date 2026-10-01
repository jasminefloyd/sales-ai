-- Reuse the existing provider's enabled choice; never introduce a new credential.
insert into public.sales_os_providers
  (tenant_id,capability,provider_key,display_name,enabled,priority,configuration)
select p.tenant_id, desired.capability, p.provider_key, p.display_name,
       p.enabled,p.priority,p.configuration
from public.sales_os_providers p
join (values
  ('exa','search_web','find_company'),
  ('hunter','find_contact','find_person'),
  ('hunter','find_contact','verify_contact')
) as desired(provider_key,existing_capability,capability)
on p.provider_key=desired.provider_key and p.capability=desired.existing_capability
where p.tenant_id='sales_os'
on conflict (tenant_id,capability,provider_key) do nothing;

-- PostgREST ON CONFLICT cannot infer the legacy partial email index.
-- PostgreSQL unique indexes still allow multiple NULL emails.
create unique index if not exists sales_os_contacts_email_upsert_unique
  on public.sales_os_contacts (tenant_id,product_id,normalized_email);
