import type { Metadata } from "next";
import { Info } from "lucide-react";

import { InfoPage } from "@/components/layout/info-page";
import { IntegrationsDashboard } from "@/components/integrations/integrations-dashboard";

export const metadata: Metadata = {
  title: "Minhas integrações",
  description: "Acompanhe os sistemas conectados ao CCM, status, última sincronização e produtos importados.",
};

export default function IntegracoesPage() {
  return (
    <InfoPage
      crumb="Minhas integrações"
      eyebrow="Central de Integração do Fornecedor"
      title="Suas integrações"
      intro="Veja os sistemas conectados, o status de cada um e sincronize quando quiser."
    >
      <div className="flex items-start gap-2 rounded-xl border border-brand-line bg-brand-bg px-4 py-3 text-sm text-brand-ink-soft">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-navy" />
        <p>
          Prévia da área do fornecedor. No CCM final, isto fica dentro da sua conta e é <strong>isolado por empresa</strong> —
          cada fornecedor enxerga e gerencia apenas as próprias integrações.
        </p>
      </div>
      <IntegrationsDashboard />
    </InfoPage>
  );
}
