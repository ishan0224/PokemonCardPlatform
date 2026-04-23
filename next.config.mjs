/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2592000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pokemontcg.io"
      },
      {
        protocol: "https",
        hostname: "assets.pokemon.com"
      },
      {
        protocol: "https",
        hostname: "*.supabase.co"
      }
    ]
  }
};

export default nextConfig;
