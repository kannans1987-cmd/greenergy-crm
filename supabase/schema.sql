-- ═══════════════════════════════════════════════════════════════
-- GREENERGY SOLAR SOLUTIONS — CRM DATABASE SCHEMA
-- Run this in Supabase SQL Editor (Project → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "uuid-ossp";

-- ─── SEQUENCES FOR AUTO-NUMBERING ───────────────────────────────
create sequence if not exists project_number_seq start 1;
create sequence if not exists job_card_number_seq start 1;

-- ═══════════════════════════════════════════════════════════════
-- TABLE 1: employee_registrations
-- Stores pending registration requests BEFORE auth account is created
-- ═══════════════════════════════════════════════════════════════
create table if not exists employee_registrations (
  id            uuid default uuid_generate_v4() primary key,
  full_name     text not null,
  email         text not null unique,
  phone         text,
  designation   text,
  department    text,
  date_of_joining date,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 2: profiles (extends auth.users)
-- Created automatically via trigger when user accepts invite
-- ═══════════════════════════════════════════════════════════════
create table if not exists profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  full_name       text not null,
  email           text not null,
  phone           text,
  designation     text,
  department      text,
  date_of_joining date,
  role            text not null default 'employee'
                  check (role in ('admin', 'task_manager', 'employee')),
  status          text not null default 'active'
                  check (status in ('active', 'inactive')),
  approved_by     uuid,
  avatar_url      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 3: projects
-- ═══════════════════════════════════════════════════════════════
create table if not exists projects (
  id                  uuid default uuid_generate_v4() primary key,
  project_number      text unique,
  name                text not null,
  customer_name       text,
  site_address        text,
  site_lat            numeric,
  site_lng            numeric,
  site_geofence_radius integer default 200, -- metres
  project_type        text check (project_type in (
                        'residential','commercial','industrial',
                        'street_light','solar_pump','hybrid'
                      )),
  capacity_kwp        numeric,
  start_date          date,
  expected_completion date,
  actual_completion   date,
  status              text default 'planning' check (status in (
                        'planning','in_progress','on_hold','completed','cancelled'
                      )),
  notes               text,
  created_by          uuid references profiles(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Auto-generate project number
create or replace function generate_project_number()
returns trigger language plpgsql as $$
begin
  if new.project_number is null then
    new.project_number := 'GSS-PRJ-' || to_char(now(), 'YYYY') || '-'
                          || lpad(nextval('project_number_seq')::text, 3, '0');
  end if;
  return new;
end;$$;

drop trigger if exists set_project_number on projects;
create trigger set_project_number
  before insert on projects
  for each row execute function generate_project_number();

-- ═══════════════════════════════════════════════════════════════
-- TABLE 4: project_employees (junction)
-- ═══════════════════════════════════════════════════════════════
create table if not exists project_employees (
  id              uuid default uuid_generate_v4() primary key,
  project_id      uuid references projects(id) on delete cascade,
  employee_id     uuid references profiles(id) on delete cascade,
  role_in_project text,
  assigned_date   date default current_date,
  released_date   date,
  unique(project_id, employee_id)
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 5: tasks
-- ═══════════════════════════════════════════════════════════════
create table if not exists tasks (
  id                uuid default uuid_generate_v4() primary key,
  title             text not null,
  description       text,
  project_id        uuid references projects(id) on delete set null,
  assigned_to       uuid references profiles(id),
  assigned_by       uuid references profiles(id),
  priority          text default 'medium' check (priority in ('high','medium','low')),
  due_date          date,
  due_time          time,
  status            text default 'pending' check (status in (
                      'pending','in_progress','completed','review','cancelled'
                    )),
  completion_notes  text,
  completed_at      timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 6: attendance
-- ═══════════════════════════════════════════════════════════════
create table if not exists attendance (
  id                  uuid default uuid_generate_v4() primary key,
  employee_id         uuid references profiles(id),
  project_id          uuid references projects(id) on delete set null,
  date                date default current_date,
  clock_in_time       timestamptz,
  clock_in_lat        numeric,
  clock_in_lng        numeric,
  clock_in_address    text,
  clock_out_time      timestamptz,
  clock_out_lat       numeric,
  clock_out_lng       numeric,
  total_hours         numeric,
  overtime_hours      numeric default 0,
  attendance_status   text default 'present' check (attendance_status in (
                        'present','absent','half_day','leave'
                      )),
  is_location_mismatch boolean default false,
  remarks             text,
  created_at          timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 7: job_cards
-- Auto-created when employee is assigned to a project
-- ═══════════════════════════════════════════════════════════════
create table if not exists job_cards (
  id              uuid default uuid_generate_v4() primary key,
  job_card_number text unique not null,
  employee_id     uuid references profiles(id),
  project_id      uuid references projects(id) on delete cascade,
  role_in_project text,
  start_date      date,
  end_date        date,
  total_manhours  numeric default 0,
  daily_notes     text,
  status          text default 'active' check (status in ('active','completed','on_hold')),
  signoff_by      uuid references profiles(id),
  signoff_at      timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Auto-create job card when employee assigned to project
create or replace function create_job_card_for_assignment()
returns trigger language plpgsql as $$
begin
  insert into job_cards (job_card_number, employee_id, project_id, role_in_project, start_date)
  values (
    'GSS-JC-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('job_card_number_seq')::text, 3, '0'),
    new.employee_id,
    new.project_id,
    new.role_in_project,
    new.assigned_date
  )
  on conflict do nothing;
  return new;
end;$$;

drop trigger if exists auto_create_job_card on project_employees;
create trigger auto_create_job_card
  after insert on project_employees
  for each row execute function create_job_card_for_assignment();

-- Update job card manhours when attendance changes
create or replace function update_job_card_manhours()
returns trigger language plpgsql as $$
begin
  update job_cards
  set
    total_manhours = (
      select coalesce(sum(total_hours), 0)
      from attendance
      where employee_id = new.employee_id
        and project_id  = new.project_id
        and total_hours is not null
    ),
    updated_at = now()
  where employee_id = new.employee_id
    and project_id  = new.project_id
    and status = 'active';
  return new;
end;$$;

drop trigger if exists update_manhours_on_attendance on attendance;
create trigger update_manhours_on_attendance
  after insert or update on attendance
  for each row execute function update_job_card_manhours();

-- ═══════════════════════════════════════════════════════════════
-- TABLE 8: leaves
-- ═══════════════════════════════════════════════════════════════
create table if not exists leaves (
  id          uuid default uuid_generate_v4() primary key,
  employee_id uuid references profiles(id),
  type        text check (type in ('sick','casual','earned')),
  from_date   date,
  to_date     date,
  reason      text,
  status      text default 'pending' check (status in ('pending','approved','rejected')),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 9: notifications
-- ═══════════════════════════════════════════════════════════════
create table if not exists notifications (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  type       text,
  title      text not null,
  message    text,
  link       text,
  is_read    boolean default false,
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 10: audit_log
-- ═══════════════════════════════════════════════════════════════
create table if not exists audit_log (
  id            uuid default uuid_generate_v4() primary key,
  action_by     uuid references profiles(id),
  action_type   text not null,
  target_entity text,
  target_id     text,
  description   text,
  metadata      jsonb,
  created_at    timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: Auto-create profile when auth user is invited & accepts
-- ═══════════════════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name, phone, designation, department, date_of_joining, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'designation',
    new.raw_user_meta_data->>'department',
    (new.raw_user_meta_data->>'date_of_joining')::date,
    coalesce(new.raw_user_meta_data->>'role', 'employee'),
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════
alter table profiles                enable row level security;
alter table employee_registrations  enable row level security;
alter table projects                enable row level security;
alter table project_employees       enable row level security;
alter table tasks                   enable row level security;
alter table attendance              enable row level security;
alter table job_cards               enable row level security;
alter table leaves                  enable row level security;
alter table notifications           enable row level security;
alter table audit_log               enable row level security;

-- Helper: is current user an admin?
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: is current user admin or task_manager?
create or replace function is_manager()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','task_manager')
  );
$$;

-- profiles: users see own; admins/managers see all
create policy "Own profile"         on profiles for select using (auth.uid() = id);
create policy "Managers view all"   on profiles for select using (is_manager());
create policy "Admin update all"    on profiles for update using (is_admin());
create policy "Admin insert"        on profiles for insert with check (is_admin());

-- employee_registrations: admin/manager full access; anon can insert (register)
create policy "Anyone can register" on employee_registrations for insert with check (true);
create policy "Managers view regs"  on employee_registrations for select using (is_manager());
create policy "Admin update regs"   on employee_registrations for update using (is_admin());

-- projects
create policy "Employees view own projects" on projects for select using (
  is_manager() or exists (
    select 1 from project_employees
    where project_id = id and employee_id = auth.uid()
  )
);
create policy "Admin manage projects" on projects for all using (is_admin());

-- tasks
create policy "View own tasks"   on tasks for select using (
  assigned_to = auth.uid() or assigned_by = auth.uid() or is_manager()
);
create policy "Manager create tasks" on tasks for insert with check (is_manager());
create policy "Update own task"  on tasks for update using (
  assigned_to = auth.uid() or is_manager()
);

-- attendance
create policy "View own attendance"   on attendance for select using (
  employee_id = auth.uid() or is_manager()
);
create policy "Employee clock in/out" on attendance for insert with check (employee_id = auth.uid());
create policy "Employee update own"   on attendance for update using (employee_id = auth.uid());
create policy "Admin override"        on attendance for update using (is_admin());

-- job_cards
create policy "View own job cards" on job_cards for select using (
  employee_id = auth.uid() or is_manager()
);
create policy "Employee update notes" on job_cards for update using (
  employee_id = auth.uid() or is_manager()
);

-- notifications
create policy "Own notifications" on notifications for select using (user_id = auth.uid());
create policy "Mark as read"      on notifications for update using (user_id = auth.uid());
create policy "System insert"     on notifications for insert with check (is_manager());

-- audit_log: admin read-only
create policy "Admin view audit" on audit_log for select using (is_admin());
create policy "System insert audit" on audit_log for insert with check (is_manager());

-- leaves
create policy "Own leaves"       on leaves for select using (employee_id = auth.uid() or is_manager());
create policy "Apply leave"      on leaves for insert with check (employee_id = auth.uid());
create policy "Manager approve"  on leaves for update using (is_manager());

-- ═══════════════════════════════════════════════════════════════
-- SEED: Insert admin profile placeholder (run AFTER creating
-- auth user via Supabase dashboard for kannan.s1987@gmail.com)
-- ═══════════════════════════════════════════════════════════════
-- NOTE: After creating the admin user in Supabase Auth dashboard,
-- update their role to 'admin':
-- UPDATE profiles SET role = 'admin' WHERE email = 'kannan.s1987@gmail.com';
