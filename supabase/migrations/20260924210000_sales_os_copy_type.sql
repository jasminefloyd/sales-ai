alter table public.sales_os_engagements
  add column if not exists copy_type text;

update public.sales_os_engagements
set copy_type = case
  when channel = 'email' then 'email'
  when channel in ('reddit', 'community') then 'community_post'
  when channel in ('professional_social', 'social') then 'social_post'
  else 'outreach_message'
end
where copy_type is null;

alter table public.sales_os_engagements
  alter column copy_type set default 'outreach_message',
  alter column copy_type set not null;

alter table public.sales_os_engagements
  drop constraint if exists sales_os_engagements_copy_type_check;

alter table public.sales_os_engagements
  add constraint sales_os_engagements_copy_type_check
  check (copy_type in ('email', 'community_post', 'social_post', 'outreach_message'));
