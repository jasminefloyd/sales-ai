-- Product deletion is an explicit, product-scoped cleanup operation. Keep the
-- event ledger append-only for normal application writes, while allowing the
-- transactional product deletion RPC to remove the deleted product's records.
create or replace function public.sales_os_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE'
     and current_setting('sales_os.product_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Sales OS events are append-only';
end;
$$;
