# Database rule tests

`workflow_v2_test.sql` creates test users and quotations, so **never run it on the live Supabase project**.

To run it on a throwaway local PostgreSQL 15+:

1. Create an empty database.
2. Load a minimal stand-in for Supabase's `auth` and `storage` schemas: the `anon`, `authenticated` and `service_role` roles, `auth.users`, `auth.uid()` reading `request.jwt.claim.sub`, `auth.role()`, `storage.buckets` and `storage.objects`.
3. Run `../SETUP_NEW_PROJECT.sql`, then this file with `psql -v ON_ERROR_STOP=1 -f workflow_v2_test.sql`.

The last line printed is `ALL WORKFLOW CHECKS PASSED`. Any broken rule stops the run with `FAILED: …` naming the check.

After editing any part file, rebuild the combined script with `node supabase/build-setup.mjs`.

`quotation_access_v1_test.sql` checks who may edit and delete quotations; it ends with `ALL QUOTATION ACCESS CHECKS PASSED`.

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
