-- ═══════════════════════════════════════════════════════════════
-- GREENERGY CRM — 9-STAGE JOB CARD WORKFLOW TABLES
-- Run this in Supabase SQL Editor as a NEW query
-- ═══════════════════════════════════════════════════════════════

-- Add stage tracking to job_cards
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS current_stage integer DEFAULT 2;
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS completion_notes text;
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS customer_sign_off boolean DEFAULT false;
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS customer_sign_off_at timestamptz;

-- ─── STAGE 3: MATERIAL ISSUANCE ─────────────────────────────
CREATE TABLE IF NOT EXISTS job_card_materials (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_card_id  uuid REFERENCES job_cards(id) ON DELETE CASCADE NOT NULL,
  issued_by    uuid REFERENCES profiles(id),
  item_name    text NOT NULL,
  quantity     numeric(10,2) NOT NULL,
  unit         text NOT NULL DEFAULT 'pcs',
  unit_cost    numeric(10,2) DEFAULT 0,
  total_cost   numeric(10,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  supplier     text,
  serial_number text,
  issue_date   date DEFAULT current_date,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE job_card_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View materials" ON job_card_materials FOR SELECT USING (issued_by = auth.uid() OR is_manager());
CREATE POLICY "Add materials" ON job_card_materials FOR INSERT WITH CHECK (issued_by = auth.uid() OR is_manager());
CREATE POLICY "Manager delete materials" ON job_card_materials FOR DELETE USING (is_manager());

-- ─── STAGE 5: MANPOWER RECORDING ────────────────────────────
CREATE TABLE IF NOT EXISTS job_card_manpower (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_card_id  uuid REFERENCES job_cards(id) ON DELETE CASCADE NOT NULL,
  employee_id  uuid REFERENCES profiles(id),
  work_date    date DEFAULT current_date,
  check_in     time,
  check_out    time,
  hours_worked numeric(4,1) NOT NULL,
  role         text,
  work_summary text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE job_card_manpower ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View manpower" ON job_card_manpower FOR SELECT USING (employee_id = auth.uid() OR is_manager());
CREATE POLICY "Add manpower" ON job_card_manpower FOR INSERT WITH CHECK (employee_id = auth.uid() OR is_manager());
CREATE POLICY "Manager delete manpower" ON job_card_manpower FOR DELETE USING (is_manager());

-- ─── STAGE 6: EXPENSE RECORDING ─────────────────────────────
CREATE TABLE IF NOT EXISTS job_card_expenses (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_card_id  uuid REFERENCES job_cards(id) ON DELETE CASCADE NOT NULL,
  recorded_by  uuid REFERENCES profiles(id),
  category     text NOT NULL,
  description  text NOT NULL,
  amount       numeric(10,2) NOT NULL,
  expense_date date DEFAULT current_date,
  vendor       text,
  receipt_url  text,
  approved     boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE job_card_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View expenses" ON job_card_expenses FOR SELECT USING (recorded_by = auth.uid() OR is_manager());
CREATE POLICY "Add expenses" ON job_card_expenses FOR INSERT WITH CHECK (recorded_by = auth.uid() OR is_manager());
CREATE POLICY "Manager update expenses" ON job_card_expenses FOR UPDATE USING (is_manager());
CREATE POLICY "Manager delete expenses" ON job_card_expenses FOR DELETE USING (is_manager());

-- ─── STAGE 7: SYSTEM TESTING ────────────────────────────────
CREATE TABLE IF NOT EXISTS job_card_tests (
  id             uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_card_id    uuid REFERENCES job_cards(id) ON DELETE CASCADE NOT NULL,
  tested_by      uuid REFERENCES profiles(id),
  test_type      text NOT NULL,
  result         text NOT NULL DEFAULT 'pass',
  measured_value text,
  expected_value text,
  notes          text,
  photos         text[],
  test_date      date DEFAULT current_date,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE job_card_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View tests" ON job_card_tests FOR SELECT USING (tested_by = auth.uid() OR is_manager());
CREATE POLICY "Add tests" ON job_card_tests FOR INSERT WITH CHECK (tested_by = auth.uid() OR is_manager());
CREATE POLICY "Manager delete tests" ON job_card_tests FOR DELETE USING (is_manager());

-- Storage policies for expense receipts & test photos
INSERT INTO storage.buckets (id, name, public) VALUES ('job-card-photos', 'job-card-photos', true) ON CONFLICT DO NOTHING;
CREATE POLICY "Upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'job-card-photos' AND auth.role() = 'authenticated');
CREATE POLICY "View photos" ON storage.objects FOR SELECT USING (bucket_id = 'job-card-photos');
