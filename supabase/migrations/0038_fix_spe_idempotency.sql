-- 0038_fix_spe_idempotency.sql
-- Fix: replace partial unique index with a proper UNIQUE constraint.
-- PostgREST cannot match ON CONFLICT against a partial index (WHERE clause).
-- All callers always provide reference_type and reference_id, so make them NOT NULL
-- and use a regular UNIQUE constraint that PostgREST can target.

-- Step 1: backfill any NULLs (should be none, but safety)
UPDATE public.supplier_performance_events
  SET reference_type = 'unknown' WHERE reference_type IS NULL;
UPDATE public.supplier_performance_events
  SET reference_id = '00000000-0000-0000-0000-000000000000' WHERE reference_id IS NULL;

-- Step 2: make NOT NULL
ALTER TABLE public.supplier_performance_events
  ALTER COLUMN reference_type SET NOT NULL,
  ALTER COLUMN reference_id SET NOT NULL;

-- Step 3: drop partial index, create proper UNIQUE constraint
DROP INDEX IF EXISTS public.idx_spe_idempotency;

ALTER TABLE public.supplier_performance_events
  ADD CONSTRAINT spe_idempotency_unique
  UNIQUE (supplier_id, event_type, reference_type, reference_id);
