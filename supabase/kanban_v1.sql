-- Kanban for tasks (27 Nov 2026)
--  Board: To do (pending) → Doing (in_progress) → Review → Done (completed). Cancelled is off the board.
--  * WIP limit: a person can have at most N tasks in "Doing" (business_settings 'kanban'.wip_per_person,
--    default 3, 0 = no limit). Starting one more is refused: finish or move one to Review first
--    ("stop starting, start finishing"). The CEO and the admin manager may go over it.
--  * Blocked: any card can be flagged blocked, with a reason (required). The person who gave the task is told.
--  * Flow data stamped by the database: started_at (first time in Doing), status_changed_at (time in the
--    current column), completed_at. They give lead time, cycle time, throughput and ageing on the board.
--  * Moving to Review tells the person who gave the task.
--  * The person doing the task may move it between columns and flag it blocked; nothing else (as before).
-- Needs allocation_levels_v1.sql and growth_v1.sql. Safe to run more than once.

alter table tasks add column if not exists blocked boolean not null default false;
alter table tasks add column if not exists blocked_reason text;
alter table tasks add column if not exists blocked_at timestamptz;
alter table tasks add column if not exists started_at timestamptz;
alter table tasks add column if not exists status_changed_at timestamptz;
update tasks set status_changed_at = coalesce(updated_at, created_at, now()) where status_changed_at is null;
alter table tasks alter column status_changed_at set default now();
create index if not exists tasks_doing_per_person on tasks (assigned_to) where status = 'in_progress';

insert into business_settings (key, data) values ('kanban', '{"wip_per_person": 3, "aging_days": 3}')
on conflict (key) do nothing;

-- The person doing the task: progress, notes and the blocked flag (the stamps below are set by the database)
create or replace function task_allocation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
        mine text[] := array['status', 'completion_notes', 'completed_at', 'updated_at', 'blocked', 'blocked_reason'];
begin
  if uid is null then return new; end if;
  if tg_op = 'INSERT' then
    new.assigned_by := uid;
    if not can_allocate_to(new.assigned_to) then raise exception '%', allocation_refusal(); end if;
    return new;
  end if;
  if is_manager() then return new; end if;
  -- An allocator may change the tasks they gave: who does it (within their rule), title, notes, dates, priority
  if can_allocate() and old.assigned_by = uid then
    if new.assigned_to is distinct from old.assigned_to and not can_allocate_to(new.assigned_to) then
      raise exception '%', allocation_refusal();
    end if;
    new.assigned_by := old.assigned_by;
    return new;
  end if;
  if (to_jsonb(new) - mine) is distinct from (to_jsonb(old) - mine) then
    raise exception 'You can move your task on the board, add notes or flag it blocked. Ask the person who gave it to change anything else.';
  end if;
  return new;
end;$$;

-- Runs after the guard (triggers fire in name order): stamps, blocked rule, WIP limit
create or replace function task_kanban()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int := coalesce((setting('kanban')->>'wip_per_person')::int, 3);
        doing int;
        who text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now());
    elsif tg_op = 'UPDATE' and old.status = 'completed' then new.completed_at := null; end if;
    if new.status in ('completed', 'cancelled') then new.blocked := false; end if;

    -- WIP limit: pull new work only when there is room
    if new.status = 'in_progress' and new.assigned_to is not null and lim > 0 and auth.uid() is not null and not is_manager() then
      select count(*) into doing from tasks where assigned_to = new.assigned_to and status = 'in_progress' and id <> new.id;
      if doing >= lim then
        select full_name into who from profiles where id = new.assigned_to;
        raise exception '% % task(s) in Doing (limit %). Finish one or move it to Review first — stop starting, start finishing.',
          case when new.assigned_to = auth.uid() then 'You already have' else coalesce(who, 'This person') || ' already has' end, doing, lim;
      end if;
    end if;
  end if;

  if new.blocked then
    new.blocked_reason := nullif(btrim(left(new.blocked_reason, 300)), '');
    if new.blocked_reason is null or length(new.blocked_reason) < 3 then raise exception 'Say what is blocking the task.'; end if;
    if tg_op = 'INSERT' or not old.blocked then new.blocked_at := now(); end if;
  else
    new.blocked_reason := null; new.blocked_at := null;
  end if;
  return new;
end;$$;
drop trigger if exists trg_task_zkanban on tasks;
create trigger trg_task_zkanban before insert or update on tasks
  for each row execute function task_kanban();

-- Tell the person who gave the task when it is blocked or ready for review
create or replace function task_kanban_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text := (select full_name from profiles where id = auth.uid());
begin
  if new.assigned_by is null or new.assigned_by = auth.uid() then return new; end if;
  if new.blocked and not old.blocked then
    insert into notifications (user_id, type, title, message, link)
      values (new.assigned_by, 'task', 'Task blocked', new.title || ': ' || new.blocked_reason || coalesce(' · ' || me, ''), '/staff/tasks?view=board');
  end if;
  if new.status = 'review' and old.status is distinct from 'review' then
    insert into notifications (user_id, type, title, message, link)
      values (new.assigned_by, 'task', 'Task ready for review', new.title || coalesce(' · ' || me, ''), '/staff/tasks?view=board');
  end if;
  return new;
end;$$;
drop trigger if exists trg_task_kanban_notify on tasks;
create trigger trg_task_kanban_notify after update on tasks
  for each row execute function task_kanban_notify();
