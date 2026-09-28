import type { Metadata, Viewport } from "next";
import { Barlow, Inter } from "next/font/google";
import Script from "next/script";

import { CartDrawer } from "@/components/cart/cart-drawer";
import { IntroLoader } from "@/components/intro/intro-loader";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";
import { INTRO_STORAGE_KEY } from "@/lib/intro";
import { site } from "@/lib/site";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-barlow",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? site.url),
  title: {
    default: `${site.name} · Material de construção com preço de atacado`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.fullName,
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: site.fullName,
    title: `${site.name} · Material de construção com preço de atacado`,
    description: site.description,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a3f94",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${barlow.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Quem já viu a abertura nesta sessão não a vê de novo, nem por um quadro:
            injeta um <style> antes da primeira pintura (sem mexer em atributos que
            o React hidrata, para não gerar aviso de mismatch). */}
        <Script id="intro-seen" strategy="beforeInteractive">
          {`try{if(sessionStorage.getItem(${JSON.stringify(INTRO_STORAGE_KEY)})==="1"){var s=document.createElement("style");s.textContent=".intro-overlay{display:none!important}";document.head.appendChild(s)}}catch(e){}`}
        </Script>
        <Providers>
          <IntroLoader />
          <Header />
          <main className="flex-1 pb-24 lg:pb-0">{children}</main>
          <Footer />
          <BottomNav />
          <CartDrawer />
        </Providers>
      </body>
    </html>
  );
}
