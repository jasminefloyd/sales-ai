-- Sales OS is currently single-tenant. Protect intent-score inserts from
-- stale workers or alternate callers explicitly sending tenant_id = null.
-- A column default does not apply when the request includes an explicit null.

create or replace function public.sales_os_fill_intent_score_tenant()
returns trigger
language plpgsql
as $$
begin
  new.tenant_id := coalesce(new.tenant_id, 'sales_os');
  return new;
end;
$$;

drop trigger if exists sales_os_intent_scores_fill_tenant
  on public.sales_os_intent_scores;

create trigger sales_os_intent_scores_fill_tenant
before insert on public.sales_os_intent_scores
for each row execute function public.sales_os_fill_intent_score_tenant();
