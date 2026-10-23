-- ============================================================================
-- CCM · Migration 0014 — Bloquear escrita na view products_public
-- ============================================================================
--
-- Contexto: QA funcional detectou que INSERT/UPDATE/DELETE na view
-- products_public retornam erros genéricos (400 NOT NULL / 204 no rows)
-- em vez de 401/403. A tabela base `products` tem RLS que bloqueia a
-- escrita real, mas a view deve ter REVOKE explícito para defense-in-depth.
--
-- O SELECT continua permitido para anon e authenticated (vitrine pública).
-- ============================================================================

REVOKE INSERT ON public.products_public FROM anon;
REVOKE UPDATE ON public.products_public FROM anon;
REVOKE DELETE ON public.products_public FROM anon;

REVOKE INSERT ON public.products_public FROM authenticated;
REVOKE UPDATE ON public.products_public FROM authenticated;
REVOKE DELETE ON public.products_public FROM authenticated;
