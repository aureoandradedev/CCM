import type { Metadata } from "next";

import { InfoPage } from "@/components/layout/info-page";
import { IntegrationWizard } from "@/components/integrations/integration-wizard";

export const metadata: Metadata = {
  title: "Integrar minha empresa",
  description: "Conecte seu catálogo ao CCM em poucos minutos: planilha, API, ERP, feed ou cadastro manual.",
};

export default function IntegrarPage() {
  return (
    <InfoPage
      crumb="Integrar minha empresa"
      eyebrow="Central de Integração do Fornecedor"
      title="Conecte seu catálogo ao CCM"
      intro="Escolha como quer trazer seus produtos. A gente mapeia, valida e deixa tudo pronto para vender — em poucos passos."
    >
      <IntegrationWizard />
    </InfoPage>
  );
}
