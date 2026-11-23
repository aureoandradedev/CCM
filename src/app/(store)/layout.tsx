import { CartDrawer } from "@/components/cart/cart-drawer";
import { IntroLoader } from "@/components/intro/intro-loader";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { getSiteSettings } from "@/lib/data/catalog";
import { ShippingProvider } from "@/lib/shipping-context";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();

  return (
    <ShippingProvider
      freeShippingFromCentavos={settings.frete.freeShippingFromCentavos}
      standardShippingCentavos={settings.frete.flatCentavos}
    >
      <IntroLoader />
      <Header />
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <Footer frete={settings.frete} />
      <BottomNav />
      <CartDrawer />
    </ShippingProvider>
  );
}
