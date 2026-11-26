-- Task delete v1 (26 Nov 2026)
--  * The CEO can delete any task (wrong, duplicate or no longer needed). Nobody else can.
--  * A copy of the deleted task is kept in the audit log.
--  * If the task was still open and assigned to someone else, that person is told it was removed.
-- Nothing else in the database refers to tasks, so deleting one cannot break other records.
-- Safe to run more than once.

drop policy if exists "CEO delete tasks" on tasks;
create policy "CEO delete tasks" on tasks for delete using (is_admin());

create or replace function task_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (action_by, action_type, target_entity, target_id, description, metadata)
  values (auth.uid(), 'task_deleted', 'tasks', old.id,
          'Task "' || left(old.title, 120) || '" deleted by ' || coalesce(my_name(), 'the server'),
          jsonb_build_object('task', to_jsonb(old)));
  if old.assigned_to is not null and old.assigned_to is distinct from auth.uid()
     and old.status not in ('completed', 'cancelled') then
    insert into notifications (user_id, type, title, message, link)
    values (old.assigned_to, 'task', 'A task given to you was removed',
            '"' || left(old.title, 120) || '" was deleted by ' || coalesce(my_name(), 'the CEO') || '. You do not need to do it.', '/staff/tasks');
  end if;
  return old;
end;$$;
drop trigger if exists trg_task_after_delete on tasks;
create trigger trg_task_after_delete after delete on tasks
  for each row execute function task_after_delete();
