import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/providers/client-providers";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "PullVault | Live Collectible Drops",
  description: "Buy, open, and reveal collectible card packs in real time."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="preconnect" href="https://images.pokemontcg.io" crossOrigin="" />
      </head>
      <body className="font-sans">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
