-- ICPs must be readable wherever the authenticated user can read their product.
-- This does not grant writes or auto-approve existing proposed revisions.
grant select on public.sales_os_icps to authenticated;
alter table public.sales_os_icps enable row level security;
drop policy if exists sales_os_icps_product_scoped_select on public.sales_os_icps;
create policy sales_os_icps_product_scoped_select
on public.sales_os_icps for select to authenticated
using (
  tenant_id = 'sales_os'
  and exists (
    select 1 from public.sales_os_products product
    where product.tenant_id = sales_os_icps.tenant_id
      and product.id = sales_os_icps.product_id
  )
);
