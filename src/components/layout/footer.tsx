import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";

import { Logo } from "@/components/layout/logo";
import { FacebookIcon, InstagramIcon, YoutubeIcon } from "@/components/ui/social-icons";
import { getCategories } from "@/lib/data/catalog";
import { site, whatsappLink } from "@/lib/site";

const HELP = [
  { href: "/como-funciona", label: "Como funciona a Central de Compras" },
  { href: "/entregas", label: "Prazos e entregas" },
  { href: "/trocas-devolucoes", label: "Trocas e devoluções" },
  { href: "/pagamentos", label: "Formas de pagamento" },
  { href: "/conta/pedidos", label: "Acompanhar pedido" },
  { href: "/ajuda", label: "Central de ajuda" },
];

const INSTITUTIONAL = [
  { href: "/sobre", label: "Sobre a Multigiro" },
  { href: "/fornecedores", label: "Seja um fornecedor" },
  { href: "/profissionais", label: "Programa para profissionais" },
  { href: "/politica-privacidade", label: "Política de privacidade" },
  { href: "/termos-de-uso", label: "Termos de uso" },
  { href: "/politica-cookies", label: "Política de cookies" },
];

const PAYMENTS = ["Pix", "Visa", "Mastercard", "Elo", "Boleto", "Faturado PJ"];

export async function Footer() {
  const categories = await getCategories();
  const year = new Date().getFullYear();

  return (
    <footer data-site-chrome className="mt-16 border-t border-brand-line bg-card">
      <div className="container-ccm grid gap-10 py-12 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm leading-relaxed text-brand-ink-soft">{site.tagline} Produtos selecionados pela nossa equipe de compras, com preço de atacado a partir de poucas unidades.</p>
          <ul className="space-y-2 text-sm text-brand-ink">
            <li className="flex items-center gap-2">
              <Phone className="size-4 text-brand-navy dark:text-brand-yellow" />
              <a href={whatsappLink()} target="_blank" rel="noreferrer" className="hover:underline">
                {site.phone} (WhatsApp)
              </a>
            </li>
            <li className="flex items-center gap-2">
              <Mail className="size-4 text-brand-navy dark:text-brand-yellow" />
              <a href={`mailto:${site.email}`} className="hover:underline">{site.email}</a>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="size-4 text-brand-navy dark:text-brand-yellow" />
              {site.address}
            </li>
            <li className="flex items-center gap-2">
              <Clock className="size-4 text-brand-navy dark:text-brand-yellow" />
              {site.hours}
            </li>
          </ul>
          <div className="flex items-center gap-2">
            {[
              { href: site.social.instagram, label: "Instagram", icon: InstagramIcon },
              { href: site.social.facebook, label: "Facebook", icon: FacebookIcon },
              { href: site.social.youtube, label: "YouTube", icon: YoutubeIcon },
            ].map(({ href, label, icon: I }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="press inline-flex size-10 items-center justify-center rounded-full border border-brand-line text-brand-navy transition-colors hover:bg-brand-yellow hover:border-brand-yellow dark:text-foreground"
              >
                <I className="size-4" />
              </a>
            ))}
          </div>
        </div>

        <FooterColumn title="Departamentos" links={categories.map((c) => ({ href: `/categoria/${c.slug}`, label: c.name }))} />
        <FooterColumn title="Ajuda" links={HELP} />
        <FooterColumn title="Institucional" links={INSTITUTIONAL} />
      </div>

      <div className="border-t border-brand-line">
        <div className="container-ccm flex flex-col gap-4 py-5 text-xs text-brand-ink-soft md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-semibold text-brand-ink">Pagamento:</span>
            {PAYMENTS.map((p) => (
              <span key={p} className="rounded-md border border-brand-line bg-background px-2 py-0.5 font-medium">
                {p}
              </span>
            ))}
          </div>
          <p>
            © {year} {site.fullName}. Preços e disponibilidade podem variar por fornecedor e região. Imagens ilustrativas.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <nav aria-label={title}>
      <h3 className="mb-3 font-heading text-base font-bold text-brand-navy dark:text-foreground">{title}</h3>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="text-sm text-brand-ink-soft transition-colors hover:text-brand-navy hover:underline dark:hover:text-foreground">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
