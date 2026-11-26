-- Migration 0074: Repair order_items qty constraint (allow qty >= 0)
--
-- Migration 0070 attempted to relax qty > 0 to qty >= 0 (needed for
-- remove_order_item_v2 which sets qty=0 on removed items), but the
-- DO block was not applied during the partial 0070 push.
-- This repair migration drops the old constraint and adds the relaxed one.

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_qty_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_qty_check CHECK (qty >= 0);
