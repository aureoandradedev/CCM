import type { NextConfig } from "next";

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const supabaseHost = hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const apiHost = hostOf(process.env.NEXT_PUBLIC_API_BASE);
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  [
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "transaction.cieloecommerce.cielo.com.br",
    "transactionsandbox.cieloecommerce.cielo.com.br",
    "mpi.braspag.com.br",
    "mpisandbox.braspag.com.br",
  ].join(" "),
  "style-src 'self' 'unsafe-inline'",
  ["img-src 'self' data: images.unsplash.com", supabaseHost]
    .filter(Boolean)
    .join(" "),
  "font-src 'self'",
  [
    "connect-src 'self'",
    supabaseHost,
    apiHost,
    "transaction.cieloecommerce.cielo.com.br",
    "transactionsandbox.cieloecommerce.cielo.com.br",
    "mpi.braspag.com.br",
    "mpisandbox.braspag.com.br",
    "viacep.com.br",
    isDev && "ws:",
  ]
    .filter(Boolean)
    .join(" "),
  "frame-src mpi.braspag.com.br mpisandbox.braspag.com.br",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
