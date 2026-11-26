import { PaymentPendingNotification } from "@/components/account/payment-pending-notification";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { IntroLoader } from "@/components/intro/intro-loader";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { getSiteSettings } from "@/lib/data/catalog";
import { getPendingPaymentOrders } from "@/lib/data/orders";
import { ShippingProvider } from "@/lib/shipping-context";
import { getCurrentUser } from "@/lib/supabase/auth";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [settings, user] = await Promise.all([getSiteSettings(), getCurrentUser()]);
  const pendingOrders = user?.role === "customer" ? await getPendingPaymentOrders() : [];

  return (
    <ShippingProvider
      freeShippingFromCentavos={settings.frete.freeShippingFromCentavos}
      standardShippingCentavos={settings.frete.flatCentavos}
    >
      <IntroLoader />
      <Header pendingPaymentCount={pendingOrders.length} />
      <PaymentPendingNotification orders={pendingOrders} />
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <Footer frete={settings.frete} />
      <BottomNav />
      <CartDrawer />
    </ShippingProvider>
  );
}
