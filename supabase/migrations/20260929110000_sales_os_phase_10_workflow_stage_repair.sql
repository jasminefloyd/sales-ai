-- Repair the workflow-stage registry after the Phase 6 trigger introduced the
-- current canonical stage names and Phase 10 introduced audience_refresh jobs.

alter table public.sales_os_jobs
  drop constraint if exists sales_os_jobs_workflow_stage_check;

alter table public.sales_os_jobs
  add constraint sales_os_jobs_workflow_stage_check
  check (workflow_stage in (
    -- Legacy values retained for existing rows.
    'product_input', 'profile_review', 'strategy_generation',
    'outreach_review', 'copy_generation',
    -- Current canonical values.
    'product', 'audience', 'find', 'engage', 'learn', 'diagnostics'
  ));

create or replace function public.sales_os_set_workflow_job_stage()
returns trigger
language plpgsql
as $$
begin
  new.workflow_stage := case new.job_type
    when 'product_analysis' then 'product'
    when 'audience_discovery' then 'audience'
    when 'audience_enrichment' then 'diagnostics'
    when 'audience_quality' then 'diagnostics'
    when 'audience_intent' then 'find'
    when 'audience_refresh' then 'audience'
    when 'activation_sync' then 'diagnostics'
    when 'find' then 'find'
    when 'engagement_batch' then 'engage'
    when 'learning_analysis' then 'learn'
    when 'attribution' then 'learn'
    when 'console_action' then 'diagnostics'
    else coalesce(new.workflow_stage, 'diagnostics')
  end;
  return new;
end;
$$;

-- Normalize any existing rows that use the current trigger's values while
-- preserving legacy rows already stored in the table.
update public.sales_os_jobs
set workflow_stage = case job_type
  when 'product_analysis' then 'product'
  when 'audience_discovery' then 'audience'
  when 'audience_enrichment' then 'diagnostics'
  when 'audience_quality' then 'diagnostics'
  when 'audience_intent' then 'find'
  when 'audience_refresh' then 'audience'
  when 'activation_sync' then 'diagnostics'
  when 'find' then 'find'
  when 'engagement_batch' then 'engage'
  when 'learning_analysis' then 'learn'
  when 'attribution' then 'learn'
  when 'console_action' then 'diagnostics'
  else workflow_stage
end
where job_type in (
  'product_analysis', 'audience_discovery', 'audience_enrichment',
  'audience_quality', 'audience_intent', 'audience_refresh', 'activation_sync',
  'find', 'engagement_batch', 'learning_analysis', 'attribution', 'console_action'
);
