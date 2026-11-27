-- Quotations: mixed DCR + Non-DCR panels and a chosen inverter phase (27 Nov 2026)
--  * panel_type 'Mixed': DCR panels for part of the size (dcr_kw), cheaper Non-DCR for the rest.
--    The subsidy is worked out on the DCR part only. panel_mix holds both parts (type, brand, Wp, count).
--  * inverter_phase: '1' or '3' when chosen on the quotation; empty = chosen automatically by size.
--  * Chosen by hand (empty = worked out from the size): dcr_panel_qty / nondcr_panel_qty (number of
--    panels of each type), panel_wp_nondcr, inverter_choice (a model from the price list), inverter_qty.
--  * price_mode / price_entry: how the price was typed. 'total_incl' = the total payable incl. GST is
--    exactly price_entry; 'per_kw_incl' = price_entry is ₹/kW incl. GST; 'per_kw' = ₹/kW before GST.
--  * Like the other prices and parts, these lock after CEO approval (use "Revise").
-- Safe to run more than once.

alter table quotation_requests drop constraint if exists qr_panel_chk;
alter table quotation_requests add constraint qr_panel_chk check (panel_type in ('DCR', 'NonDCR', 'Mixed'));
alter table quotation_requests add column if not exists dcr_kw numeric;
alter table quotation_requests add column if not exists panel_mix jsonb;
alter table quotation_requests add column if not exists panel_brand_nondcr text;
alter table quotation_requests add column if not exists inverter_phase text;
alter table quotation_requests add column if not exists dcr_panel_qty integer;
alter table quotation_requests add column if not exists nondcr_panel_qty integer;
alter table quotation_requests add column if not exists panel_wp_nondcr integer;
alter table quotation_requests add column if not exists inverter_choice text;
alter table quotation_requests add column if not exists inverter_qty integer;
alter table quotation_requests add column if not exists price_mode text;
alter table quotation_requests add column if not exists price_entry numeric;
alter table quotation_requests drop constraint if exists qr_panel_qty_chk;
alter table quotation_requests add constraint qr_panel_qty_chk check (coalesce(dcr_panel_qty, 0) between 0 and 5000 and coalesce(nondcr_panel_qty, 0) between 0 and 5000
  and coalesce(inverter_qty, 1) between 1 and 50);
alter table quotation_requests drop constraint if exists qr_price_mode_chk;
alter table quotation_requests add constraint qr_price_mode_chk check ((price_mode is null or price_mode in ('per_kw', 'per_kw_incl', 'total_incl'))
  and (price_entry is null or price_entry > 0));
alter table quotation_requests drop constraint if exists qr_inverter_phase_chk;
alter table quotation_requests add constraint qr_inverter_phase_chk check (inverter_phase is null or inverter_phase in ('1', '3'));
alter table quotation_requests drop constraint if exists qr_dcr_kw_chk;
alter table quotation_requests add constraint qr_dcr_kw_chk check (dcr_kw is null or dcr_kw > 0);

create or replace function quotation_mix_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not (quotation_editable(new.status) or (quotation_editable(old.status) and new.status = 'owner_approval_pending')) and (
       new.dcr_kw is distinct from old.dcr_kw or new.panel_mix is distinct from old.panel_mix
    or new.panel_brand_nondcr is distinct from old.panel_brand_nondcr or new.inverter_phase is distinct from old.inverter_phase
    or new.system_phase is distinct from old.system_phase
    or new.dcr_panel_qty is distinct from old.dcr_panel_qty or new.nondcr_panel_qty is distinct from old.nondcr_panel_qty
    or new.panel_wp_nondcr is distinct from old.panel_wp_nondcr or new.inverter_choice is distinct from old.inverter_choice
    or new.inverter_qty is distinct from old.inverter_qty or new.price_mode is distinct from old.price_mode
    or new.price_entry is distinct from old.price_entry) then
    raise exception 'The panels, inverter and price are locked after approval. Use "Revise" — the CEO must approve the new version.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_quotation_mix_guard on quotation_requests;
create trigger trg_quotation_mix_guard before update on quotation_requests
  for each row execute function quotation_mix_guard();
