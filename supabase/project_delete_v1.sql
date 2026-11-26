-- Project delete v1 (26 Nov 2026)
--  * The CEO can delete a project that has NO numbered job card (wrong, test or duplicate entries).
--  * A project with a job card (GSS/JC/...) or linked to a quotation can never be deleted, by anyone.
--  * Team assignments, field job cards (and their logs, materials, expenses), milestones, payments and
--    documents of the project go with it; tasks and attendance are kept (their project link is cleared).
--  * A reason is required; a snapshot of the project and what was removed is kept in the audit log.
-- Safe to run more than once.

create or replace function project_delete_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.job_number is not null then
    raise exception 'Project % has job card % and cannot be deleted.', old.project_number, old.job_number;
  end if;
  if old.quotation_id is not null or exists (select 1 from quotation_requests where project_id = old.id) then
    raise exception 'Project % is linked to a quotation and cannot be deleted.', old.project_number;
  end if;
  if coalesce(current_setting('greenergy.deleting_project', true), '') <> old.id::text then
    raise exception 'Use "Delete project" (CEO) to delete a project.';
  end if;
  return old;
end;$$;
drop trigger if exists trg_project_delete_guard on projects;
create trigger trg_project_delete_guard before delete on projects
  for each row execute function project_delete_guard();

-- What would be removed (shown to the CEO before deleting)
create or replace function project_delete_preview(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr projects%rowtype;
begin
  if not is_admin() then raise exception 'Only the CEO can delete a project.'; end if;
  select * into pr from projects where id = p_project;
  if not found then raise exception 'Project not found.'; end if;
  return jsonb_build_object(
    'can_delete',  pr.job_number is null and pr.quotation_id is null and not exists (select 1 from quotation_requests where project_id = pr.id),
    'job_number',  pr.job_number,
    'team',        (select count(*) from project_employees where project_id = pr.id),
    'field_job_cards', (select count(*) from job_cards where project_id = pr.id),
    'field_entries', (select count(*) from job_card_materials m join job_cards j on j.id = m.job_card_id where j.project_id = pr.id)
                   + (select count(*) from job_card_logs l join job_cards j on j.id = l.job_card_id where j.project_id = pr.id),
    'milestones',  (select count(*) from project_stage_history where project_id = pr.id),
    'payments_paid', (select count(*) from project_payments where project_id = pr.id and status = 'paid'),
    'documents',   (select count(*) from project_documents where project_id = pr.id),
    'tasks',       (select count(*) from tasks where project_id = pr.id),
    'attendance_days', (select count(*) from attendance where project_id = pr.id));
end;$$;

create or replace function delete_project(p_project uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare pr projects%rowtype; v_info jsonb;
begin
  if not is_admin() then raise exception 'Only the CEO can delete a project.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a short reason for deleting.'; end if;
  select * into pr from projects where id = p_project for update;
  if not found then raise exception 'Project not found.'; end if;
  v_info := project_delete_preview(p_project);
  if not (v_info->>'can_delete')::boolean then
    raise exception 'Project % has a job card or a quotation and cannot be deleted.', pr.project_number;
  end if;

  insert into audit_log (action_by, action_type, target_entity, target_id, description, metadata)
  values (auth.uid(), 'project_deleted', 'projects', pr.id,
          'Project ' || pr.project_number || ' (' || coalesce(pr.customer_name, pr.name) || ') deleted: ' || trim(p_reason),
          jsonb_build_object('project', to_jsonb(pr), 'removed', v_info, 'reason', trim(p_reason),
                             'team', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from project_employees e where e.project_id = pr.id),
                             'field_job_cards', (select coalesce(jsonb_agg(to_jsonb(j)), '[]') from job_cards j where j.project_id = pr.id)));

  perform set_config('greenergy.deleting_project', pr.id::text, true);
  delete from projects where id = pr.id;
  perform set_config('greenergy.deleting_project', '', true);
end;$$;

revoke all on function project_delete_preview(uuid), delete_project(uuid, text) from public, anon;
grant execute on function project_delete_preview(uuid), delete_project(uuid, text) to authenticated;
