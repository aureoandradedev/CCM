import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Fotos placeholder enquanto os fornecedores não mandam as imagens reais.
      { protocol: "https", hostname: "images.unsplash.com" },
      // Storage do Supabase (imagens de produto enviadas pelo admin/fornecedor).
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
