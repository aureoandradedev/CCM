-- Migration 0060: Tighten receiving_items quantity CHECK from <= to =
--
-- Invariant: accepted_qty + damaged_qty = received_qty
-- (every received unit must be classified as either accepted or damaged)
--
-- Pre-conditions verified:
--   1. All 6 existing receiving_items satisfy the equality
--   2. The only INSERT/UPSERT path (recordItem) now enforces !== server-side
--   3. Defaults (0,0,0) satisfy 0+0=0
--   4. Frontend blocks save when accepted+damaged !== received
--
-- The old CHECK (<=) allowed unclassified quantities, which caused the WJ8848
-- bug: accepted_qty=0 with received_qty=1 meant stock never entered inventory
-- via confirm_allocation_atomic PHASE A (which filters accepted_qty > 0).

alter table public.receiving_items
  drop constraint receiving_items_qty_check;

alter table public.receiving_items
  add constraint receiving_items_qty_check
  check (accepted_qty + damaged_qty = received_qty);
