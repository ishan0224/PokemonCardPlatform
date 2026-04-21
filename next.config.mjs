/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pokemontcg.io"
      },
      {
        protocol: "https",
        hostname: "assets.pokemon.com"
      }
    ]
  }
};

export default nextConfig;
