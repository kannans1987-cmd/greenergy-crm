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
