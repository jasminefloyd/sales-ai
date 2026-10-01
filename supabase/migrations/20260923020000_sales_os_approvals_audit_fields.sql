-- The approval state-transition trigger reads updated_by. Keep approvals
-- consistent with the other mutable Sales OS state tables.
alter table public.sales_os_approvals
  add column if not exists created_by text,
  add column if not exists updated_by text;

update public.sales_os_approvals
set updated_by = coalesce(updated_by, state_changed_by, requested_by),
    created_by = coalesce(created_by, requested_by)
where updated_by is null or created_by is null;
