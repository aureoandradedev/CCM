/** Dados institucionais do CCM usados em header, footer, metadados e WhatsApp. */
export const site = {
  name: "Multigiro Central de Compras",
  shortName: "Central de Compras",
  fullName: "Multigiro Central de Compras",
  tagline: "Material de construção com preço de atacado, direto do fornecedor.",
  description:
    "Central de Compras Multigiro: cimento, pisos, tintas, elétrica, hidráulica, louças e ferramentas com preço de varejo e atacado, entregues direto dos fornecedores parceiros.",
  url: "https://ccm.multigiroatacadao.com.br",
  phone: "(28) 99979-1021",
  whatsapp: "5528999791021",
  email: "compras@multigiroatacadao.com.br",
  address: "Cachoeiro de Itapemirim, ES",
  hours: "Seg. a sex. 7h às 18h · Sáb. 7h às 13h",
  social: {
    instagram: "https://instagram.com/multigiroatacadao",
    facebook: "https://facebook.com/multigiroatacadao",
    youtube: "https://youtube.com/@multigiroatacadao",
  },
} as const;

export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${site.whatsapp}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
