-- Job Card Logs table for daily progress entries
create table if not exists job_card_logs (
  id             uuid default uuid_generate_v4() primary key,
  job_card_id    uuid references job_cards(id) on delete cascade not null,
  employee_id    uuid references profiles(id) not null,
  log_date       date not null default current_date,
  log_time       time not null default current_time,
  work_description text not null,
  materials_used text,
  observations   text,
  photos         text[],
  manhours       numeric(5,2) default 0,
  created_at     timestamptz default now()
);

alter table job_card_logs enable row level security;
create policy "View own or manager logs" on job_card_logs for select using (employee_id = auth.uid() or is_manager());
create policy "Insert own logs" on job_card_logs for insert with check (employee_id = auth.uid());
create policy "Update own logs" on job_card_logs for update using (employee_id = auth.uid());

-- Storage bucket for job card photos (run this too)
insert into storage.buckets (id, name, public) values ('job-card-photos', 'job-card-photos', true) on conflict do nothing;
create policy "Upload job card photos" on storage.objects for insert with check (bucket_id = 'job-card-photos' and auth.role() = 'authenticated');
create policy "View job card photos" on storage.objects for select using (bucket_id = 'job-card-photos');
