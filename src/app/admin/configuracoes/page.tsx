import { CcmConfigsPanel } from "@/components/admin/ccm-configs-panel";
import { AdminRoleForm, FreightForm } from "@/components/admin/settings-forms";
import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminAdmins, adminConfigs, adminSettings, configured } from "@/lib/admin/data";

export default async function AdminSettingsPage() {
  if (!configured()) return <NotConfigured />;
  const [settings, admins, configs] = await Promise.all([adminSettings(), adminAdmins(), adminConfigs()]);
  return (
    <>
      <PageTitle title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Frete">
          <FreightForm value={settings.frete} />
        </Card>
        <Card title="Administradores">
          <ul className="mb-4 space-y-1 text-sm">
            {admins.map((a) => (
              <li key={a.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5">
                <span>{a.full_name || "—"}</span>
                <span className="text-brand-ink-soft">{a.email}</span>
              </li>
            ))}
          </ul>
          <AdminRoleForm />
        </Card>
        <Card title="Configurações CCM (operação)" className="lg:col-span-2">
          <CcmConfigsPanel configs={configs} />
        </Card>
        <Card title="Integrações" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-brand-ink-soft">Servidor de pedidos (backend)</dt>
              <dd className="font-mono text-xs break-all">{process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-brand-ink-soft">Supabase</dt>
              <dd className="font-mono text-xs break-all">{process.env.NEXT_PUBLIC_SUPABASE_URL}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-brand-ink-soft">Pagamentos e fotos</dt>
              <dd className="text-xs">Chaves da Cielo e do QRofertas ficam em backend/.env (nunca no site).</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
