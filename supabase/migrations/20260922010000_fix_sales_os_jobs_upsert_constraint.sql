-- Make the Sales OS job idempotency key inferable by ON CONFLICT.
--
-- The original Phase 13 index was partial (idempotency_key IS NOT NULL).
-- PostgreSQL cannot infer a partial unique index from the conflict target used
-- by the application upsert. A regular unique index has the same desired
-- NULL behavior because PostgreSQL does not consider NULL values equal.

drop index if exists public.sales_os_jobs_idempotency_unique;

create unique index sales_os_jobs_idempotency_unique
  on public.sales_os_jobs (tenant_id, product_id, idempotency_key);
