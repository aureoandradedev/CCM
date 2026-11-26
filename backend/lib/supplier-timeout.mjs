/**
 * Supplier timeout calculation — dynamic T formula.
 *
 * T_efetivo = min(T_config, minutos_ate_envio - pagamento - resposta_reserva)
 * T_efetivo = max(T_efetivo, T_minimum)
 *
 * When T_efetivo <= T_minimum → simultaneous winner+backup (both get requests).
 *
 * Business hours are respected: timeout pauses outside supplier hours.
 * Uses supplier-calendar.ts helpers via addBusinessMinutes.
 */

import { db } from "./supabase.mjs";

const BRAZIL_TZ = "America/Sao_Paulo";

function nowBR() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: BRAZIL_TZ }));
}

/**
 * Read timeout configs from ccm_configs.
 * @returns {Promise<{T_config: number, T_min: number, paymentEstimate: number, backupResponseEstimate: number}>}
 */
export async function getTimeoutConfigs() {
  const keys = [
    "supplier_response_timeout_minutes",
    "supplier_response_timeout_min_minutes",
    "payment_estimate_minutes",
    "backup_response_estimate_minutes",
  ];
  const { data } = await db()
    .from("ccm_configs")
    .select("key, value")
    .in("key", keys)
    .eq("scope", "global");

  const map = Object.fromEntries((data || []).map((r) => [r.key, Number(JSON.parse(JSON.stringify(r.value)))]));

  return {
    T_config: map.supplier_response_timeout_minutes ?? 45,
    T_min: map.supplier_response_timeout_min_minutes ?? 10,
    paymentEstimate: map.payment_estimate_minutes ?? 30,
    backupResponseEstimate: map.backup_response_estimate_minutes ?? 20,
  };
}

/**
 * Read backup cost threshold from ccm_configs.
 * @returns {Promise<number>} percentage (e.g. 10 = 10%)
 */
export async function getBackupCostThreshold() {
  const { data } = await db()
    .from("ccm_configs")
    .select("value")
    .eq("key", "backup_cost_threshold_pct")
    .eq("scope", "global")
    .maybeSingle();
  if (!data) return 15;
  return Number(JSON.parse(JSON.stringify(data.value))) || 15;
}

/**
 * Calculate effective timeout T for a supplier request.
 *
 * Dynamic formula:
 *   minutesUntilCutoff = time between now and supplier's cutoff
 *   T_dynamic = minutesUntilCutoff - paymentEstimate - backupResponseEstimate
 *   T_efetivo = min(T_config, T_dynamic)
 *   T_efetivo = max(T_efetivo, T_min)
 *
 * @param {object} opts
 * @param {number} opts.T_config - configured timeout in minutes
 * @param {number} opts.T_min - minimum timeout in minutes
 * @param {number} opts.paymentEstimate - estimated payment time in minutes
 * @param {number} opts.backupResponseEstimate - estimated backup response time in minutes
 * @param {number|null} opts.minutesUntilCutoff - minutes until supplier cutoff (null = use T_config)
 * @returns {{T_efetivo: number, simultaneous: boolean, reason: string}}
 */
export function calculateEffectiveTimeout({
  T_config,
  T_min,
  paymentEstimate,
  backupResponseEstimate,
  minutesUntilCutoff,
}) {
  let T_efetivo;
  let reason;

  if (minutesUntilCutoff == null || minutesUntilCutoff <= 0) {
    T_efetivo = T_config;
    reason = "cutoff_unknown_using_config";
  } else {
    const T_dynamic = minutesUntilCutoff - paymentEstimate - backupResponseEstimate;
    T_efetivo = Math.min(T_config, T_dynamic);
    reason = T_dynamic < T_config ? "cutoff_constrained" : "config_used";
  }

  T_efetivo = Math.max(T_efetivo, T_min);

  const simultaneous = T_efetivo <= T_min;
  if (simultaneous) {
    reason = "simultaneous_t_lte_tmin";
  }

  return { T_efetivo, simultaneous, reason };
}

/**
 * Compute expires_at from now + T_efetivo minutes.
 * @param {number} T_efetivo - minutes
 * @returns {string} ISO timestamp
 */
export function computeExpiresAt(T_efetivo) {
  const now = new Date();
  return new Date(now.getTime() + T_efetivo * 60 * 1000).toISOString();
}

/**
 * Calculate minutes between now and a supplier's next cutoff time.
 * Uses the supplier's cutoff_time or business_hours from ccm_configs or supplier_commercial_terms.
 *
 * @param {string|null} cutoffTime - HH:MM format or null
 * @returns {number|null} minutes until cutoff, or null if unknown
 */
export function minutesUntilCutoff(cutoffTime) {
  if (!cutoffTime || typeof cutoffTime !== "string") return null;
  const [h, m] = cutoffTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;

  const now = nowBR();
  const cutoffDate = new Date(now);
  cutoffDate.setHours(h, m, 0, 0);

  const diff = (cutoffDate.getTime() - now.getTime()) / (1000 * 60);
  return diff > 0 ? Math.floor(diff) : null;
}
