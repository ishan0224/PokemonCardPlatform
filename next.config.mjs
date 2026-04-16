/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // We are not using next/image in the current codebase.
    // Keep optimizer off to reduce attack surface from image optimizer CVEs
    // until the planned framework security upgrade is completed.
    unoptimized: true
  }
};

export default nextConfig;
