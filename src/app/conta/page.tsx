import type { Metadata } from "next";

import { AuthPanel } from "@/components/account/auth-panel";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };

export default function AccountPage() {
  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: "Minha conta" }]} />
      <h1 className="mt-4 mb-6 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem] dark:text-foreground">Minha conta</h1>
      <AuthPanel />
    </div>
  );
}
