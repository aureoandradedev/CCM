-- Migration 0062: (superseded by 0063)
--
-- Original intent: widen entregador RPCs for admin visibility.
-- Failed on apply because CREATE OR REPLACE cannot change RETURNS TABLE
-- signature (12 → 15 columns). PostgreSQL error SQLSTATE 42P13.
--
-- The correct DROP + CREATE approach is in 0063_fix_entregador_rpc_overloads.sql.
-- This file is intentionally a no-op so the migration history stays sequential.

SELECT 1;
