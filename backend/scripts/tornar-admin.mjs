/**
 * Dá (ou tira) o papel de admin para um usuário já cadastrado.
 *   node scripts/tornar-admin.mjs --email pedro@multigiro.com.br
 *   node scripts/tornar-admin.mjs --email pedro@multigiro.com.br --revogar
 */
import { db } from "../lib/supabase.mjs";

const args = process.argv.slice(2);
const email = (args[args.indexOf("--email") + 1] || "").trim().toLowerCase();
const revogar = args.includes("--revogar");
if (!email) {
  console.error("uso: node scripts/tornar-admin.mjs --email <email> [--revogar]");
  process.exit(1);
}

const { data: perfil } = await db().from("profiles").select("id, email, role").eq("email", email).maybeSingle();
if (!perfil) {
  console.error(`Nenhum perfil com o e-mail ${email}. A pessoa precisa criar a conta no site primeiro.`);
  process.exit(1);
}
const { error } = await db().from("profiles").update({ role: revogar ? "customer" : "admin" }).eq("id", perfil.id);
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`✓ ${email} agora é ${revogar ? "cliente" : "ADMIN"}.`);
