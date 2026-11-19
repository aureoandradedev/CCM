-- 0051: Confirmation reminder tracking.
-- Tracks reminders sent for orders awaiting confirmation (aguardando-confirmacao).
-- Reminder schedule is configurable via ccm_configs (default OFF).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Table: confirmation_reminders — one row per reminder sent
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.confirmation_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reminder_no smallint NOT NULL CHECK (reminder_no BETWEEN 1 AND 10),
  channel     text NOT NULL DEFAULT 'internal' CHECK (channel IN ('internal','whatsapp','email')),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  sent_by     uuid REFERENCES public.profiles(id),
  UNIQUE (order_id, reminder_no)
);

COMMENT ON TABLE public.confirmation_reminders IS 'Tracks reminders sent for orders awaiting Compras confirmation.';

ALTER TABLE public.confirmation_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_compras_full"
  ON public.confirmation_reminders
  FOR ALL
  USING  (has_role(ARRAY['compras']))
  WITH CHECK (has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Seed default reminder config (OFF by default)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ccm_configs (key, scope, value)
VALUES (
  'confirmation_reminders',
  'global',
  '{"enabled": false, "schedule_minutes": [10, 20, 30], "channel": "internal"}'
)
ON CONFLICT (scope, key) DO NOTHING;

COMMIT;
