# Database rule tests

`workflow_v2_test.sql` creates test users and quotations, so **never run it on the live Supabase project**.

To run it on a throwaway local PostgreSQL 15+:

1. Create an empty database.
2. Load a minimal stand-in for Supabase's `auth` and `storage` schemas: the `anon`, `authenticated` and `service_role` roles, `auth.users`, `auth.uid()` reading `request.jwt.claim.sub`, `auth.role()`, `storage.buckets` and `storage.objects`.
3. Run `../SETUP_NEW_PROJECT.sql`, then this file with `psql -v ON_ERROR_STOP=1 -f workflow_v2_test.sql`.

The last line printed is `ALL WORKFLOW CHECKS PASSED`. Any broken rule stops the run with `FAILED: …` naming the check.

After editing any part file, rebuild the combined script with `node supabase/build-setup.mjs`.

`quotation_access_v1_test.sql` checks who may edit and delete quotations; it ends with `ALL QUOTATION ACCESS CHECKS PASSED`.

`quotation_view_v1_test.sql` checks "Quotations: view all" (admin executives, project manager): they see every quotation but not supplier costing, cannot change, delete or write on it, can log phone enquiries, and their change requests apply only after the CEO approves; it ends with `ALL QUOTATION VIEW CHECKS PASSED`.

`quotation_panels_v1_test.sql` checks mixed DCR + Non-DCR panels and the chosen inverter phase: valid values only, saved by the preparer, locked after approval, and counted correctly by auto-approval; it ends with `ALL MIXED PANEL CHECKS PASSED`.

`allocation_levels_v1_test.sql` checks Sr / Jr Admin Managers: only the CEO sets the level; a Jr allocates tasks, quotation people and service jobs to anyone except a Sr, a Sr to anyone; neither can change the quotation itself, see costing or close jobs; staff only update their own task progress; it ends with `ALL ALLOCATION LEVEL CHECKS PASSED`.

`kanban_v1_test.sql` checks the task board: start / column / done times stamped, the WIP limit per person (and that the CEO can go over it, 0 = off), blocked needs a reason and tells the giver, Review tells the giver, people move only their own cards; it ends with `ALL KANBAN CHECKS PASSED`.

`leave_policy_v1_test.sql` checks the leave policy: casual 1 paid (2 if genuine) with 5 days notice and LOP from the 3rd day, abrupt casual leave all LOP, sick paid only with a certificate, absences LOP with a termination review past 10 days, approval Sr Admin Manager then CEO, and who sees what; it ends with `ALL LEAVE POLICY CHECKS PASSED`.

`attendance_view_v1_test.sql` checks that a Sr / Jr Admin Manager sees everyone's clock-in and clock-out but cannot clock anyone in, change a time, delete a session or change the attendance type, sees who is on leave (type only, no reason), and loses the view when they go back to staff; it ends with `ALL ATTENDANCE VIEW CHECKS PASSED`.

`staff_photos_v1_test.sql` checks staff photos: each person sets their own, the CEO sets anyone's, nobody uploads into or deletes from someone else's folder, and the photo link must be the person's own file in the staff-photos bucket; it ends with `ALL STAFF PHOTO CHECKS PASSED`.

`super_admin_v1_test.sql` checks the Super Admin: CEO powers, but cannot change / deactivate / delete the CEO, cannot make anyone CEO or Super Admin, cannot change their own role; every change (and every server action in the audit log) is recorded for the CEO with before / after, the CEO gets one grouped notification, only the CEO reads the record and marks it reviewed, nobody can edit or delete it; it ends with `ALL SUPER ADMIN CHECKS PASSED`.

`project_manager_v1_test.sql` checks the Project Manager: gives tasks, service jobs and site visits to Solar Technicians, Helpers (by designation), Jr Admin Managers and themselves, never to a Sr Admin Manager, sales staff or the CEO; sees quotations without costing and team attendance; does not approve leave; it ends with `ALL PROJECT MANAGER CHECKS PASSED`.

`attendance_late_v1_test.sql` checks late marks: start 09:40 + 40 min grace (10:20 on time, 10:35 = 55 min late), only the first clock-in of the day, the weekly off never late, the person and the CEO told, a changed or broken setting, and excusing (CEO only, with a reason); it ends with `ALL LATE MARK CHECKS PASSED`.

`attendance_v1_test.sql` checks office GPS clock-in, site clock-in and clock-out rules; it ends with `ALL ATTENDANCE CHECKS PASSED`. Run each test file on its own fresh database.

`quotation_allocation_v1_test.sql` checks the site-visit person, preparer and follow-up person rules; it ends with `ALL ALLOCATION CHECKS PASSED`.

`lead_temperature_v1_test.sql` checks hot / cold at any stage; it ends with `ALL HOT / COLD CHECKS PASSED`.

`job_card_ongoing_v1_test.sql` checks job cards for ongoing projects; it ends with `ALL ONGOING JOB CARD CHECKS PASSED`.

`project_delete_v1_test.sql` checks who may delete a project and what is kept; it ends with `ALL PROJECT DELETE CHECKS PASSED`.

`task_delete_v1_test.sql` checks that only the CEO deletes tasks; it ends with `ALL TASK DELETE CHECKS PASSED`.

`attendance_multi_v1_test.sql` checks several clock-ins a day for site / O&M staff and once a day for office staff; it ends with `ALL MULTI-SESSION ATTENDANCE CHECKS PASSED`.

`growth_v1_test.sql` checks first contact and alerts, lost reasons, auto-approval, referrals, payments and the commissioning gate; it ends with `ALL GROWTH CHECKS PASSED`.

`service_v1_test.sql` checks AMC contracts and visits, service jobs, technician rights, invoices and O&M clock-in on a job; it ends with `ALL SERVICE CHECKS PASSED`.

`attendance_outside_v1_test.sql` checks "Out on work" sessions (site visits for leads, EB office, purchases, bank / govt office): purpose and note rules, links only to the person's own leads / projects, and that the purpose cannot be changed later; it ends with `ALL OUT-ON-WORK ATTENDANCE CHECKS PASSED`.

`attendance_forgot_v1_test.sql` checks forgotten clock-outs: yesterday's open session does not block today, is not closed by today's clock-out, the CEO is told once and sets the real time; it ends with `ALL FORGOTTEN CLOCK-OUT CHECKS PASSED`.
