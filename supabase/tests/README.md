# Database rule tests

`workflow_v2_test.sql` creates test users and quotations, so **never run it on the live Supabase project**.

To run it on a throwaway local PostgreSQL 15+:

1. Create an empty database.
2. Load a minimal stand-in for Supabase's `auth` and `storage` schemas: the `anon`, `authenticated` and `service_role` roles, `auth.users`, `auth.uid()` reading `request.jwt.claim.sub`, `auth.role()`, `storage.buckets` and `storage.objects`.
3. Run `../SETUP_NEW_PROJECT.sql`, then this file with `psql -v ON_ERROR_STOP=1 -f workflow_v2_test.sql`.

The last line printed is `ALL WORKFLOW CHECKS PASSED`. Any broken rule stops the run with `FAILED: …` naming the check.

After editing any part file, rebuild the combined script with `node supabase/build-setup.mjs`.
