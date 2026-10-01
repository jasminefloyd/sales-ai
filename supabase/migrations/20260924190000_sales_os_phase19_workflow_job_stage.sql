alter table public.sales_os_jobs
  add column if not exists workflow_stage text
  check (workflow_stage in (
    'product_input',
    'profile_review',
    'strategy_generation',
    'outreach_review',
    'copy_generation',
    'learning',
    'diagnostics'
  ));

create or replace function public.sales_os_set_workflow_job_stage()
returns trigger language plpgsql as $$
begin
  new.workflow_stage := case new.job_type
    when 'product_analysis' then 'profile_review'
    when 'audience_discovery' then 'strategy_generation'
    when 'engagement_batch' then 'copy_generation'
    when 'learning_analysis' then 'learning'
    when 'attribution' then 'learning'
    when 'find' then 'diagnostics'
    when 'console_action' then 'diagnostics'
    else new.workflow_stage
  end;
  return new;
end;
$$;

drop trigger if exists sales_os_jobs_workflow_stage on public.sales_os_jobs;
create trigger sales_os_jobs_workflow_stage
  before insert or update of job_type on public.sales_os_jobs
  for each row execute function public.sales_os_set_workflow_job_stage();

update public.sales_os_jobs
set workflow_stage = case job_type
  when 'product_analysis' then 'profile_review'
  when 'audience_discovery' then 'strategy_generation'
  when 'engagement_batch' then 'copy_generation'
  when 'learning_analysis' then 'learning'
  when 'attribution' then 'learning'
  when 'find' then 'diagnostics'
  when 'console_action' then 'diagnostics'
end
where workflow_stage is null;
