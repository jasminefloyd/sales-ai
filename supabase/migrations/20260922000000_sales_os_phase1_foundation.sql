-- Sales OS Phase 1 foundation.
-- This migration intentionally creates no operational tables. Phase 2 owns the
-- canonical state model. The helper below establishes the tenant invariant for
-- later migrations and is itself namespace-compliant.

create or replace function public.sales_os_assert_tenant(p_tenant_id text)
returns void
language plpgsql
immutable
as $$
begin
  if p_tenant_id is distinct from 'sales_os' then
    raise exception 'Invalid Sales OS tenant: expected sales_os';
  end if;
end;
$$;

comment on function public.sales_os_assert_tenant(text) is
  'Rejects any tenant other than the permanently assigned Sales OS tenant.';

revoke all on function public.sales_os_assert_tenant(text) from public;
