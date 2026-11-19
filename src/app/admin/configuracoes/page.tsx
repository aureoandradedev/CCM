import { CcmConfigsPanel } from "@/components/admin/ccm-configs-panel";
import { CdConfigPanel } from "@/components/admin/cd-config-panel";
import { HolidayCalendarPanel } from "@/components/admin/holiday-calendar-panel";
import { AdminRoleForm, FreightForm } from "@/components/admin/settings-forms";
import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminAdmins, adminConfigs, adminSettings, readCdConfig, readHolidayCalendars, configured } from "@/lib/admin/data";

export default async function AdminSettingsPage() {
  if (!configured()) return <NotConfigured />;
  const [settings, admins, configs, holidays, cdConfig] = await Promise.all([
    adminSettings(), adminAdmins(), adminConfigs(), readHolidayCalendars(), readCdConfig(),
  ]);
  return (
    <>
      <PageTitle title="Configurações" />

      {/* ── Operação ──────────────────────────────────────── */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">Operação</h2>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Frete">
          <FreightForm value={settings.frete} />
        </Card>
        <Card title="Configurações CCM" className="lg:col-span-1">
          <CcmConfigsPanel configs={configs} />
        </Card>
      </div>

      {/* ── Calendário + CD ───────────────────────────────── */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">Calendário e CD</h2>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Feriados">
          <HolidayCalendarPanel holidays={holidays} />
        </Card>
        <Card title="Centro de Distribuição">
          <CdConfigPanel city={cdConfig.city} state={cdConfig.state} address={cdConfig.address} hours={cdConfig.hours} />
        </Card>
      </div>

      {/* ── Acesso ────────────────────────────────────────── */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">Acesso</h2>
      <div className="mb-6">
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
      </div>

      {/* ── Sistema (recolhido por padrão) ────────────────── */}
      <details>
        <summary className="mb-3 cursor-pointer text-sm font-bold uppercase tracking-wide text-brand-ink-soft hover:text-brand-navy">
          Sistema
        </summary>
        <div className="mb-6">
          <Card title="Informações técnicas">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold text-brand-ink-soft">Servidor de pedidos</dt>
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
      </details>
    </>
  );
}
