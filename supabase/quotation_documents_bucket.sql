-- ═══════════════════════════════════════════════════════════════
-- QUOTATION DOCUMENTS STORAGE BUCKET
-- Run in Supabase SQL Editor after quotation_module.sql
--
-- Holds customer-submitted files from the public /quote form
-- (electricity bill, roof photo). Uploads happen server-side via
-- the service-role client (app/api/quotations/route.ts), since the
-- public form has no authenticated user to scope RLS by — so no
-- public INSERT storage policy is needed, only public SELECT so the
-- resulting URLs are viewable by staff/customers.
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('quotation-documents', 'quotation-documents', true)
on conflict do nothing;

drop policy if exists "View quotation documents" on storage.objects;
create policy "View quotation documents" on storage.objects
  for select using (bucket_id = 'quotation-documents');

-- Authenticated staff can also upload directly to this bucket
-- (e.g. future document-management UI), in addition to the
-- service-role uploads from the public form.
drop policy if exists "Staff upload quotation documents" on storage.objects;
create policy "Staff upload quotation documents" on storage.objects
  for insert with check (bucket_id = 'quotation-documents' and auth.role() = 'authenticated');
