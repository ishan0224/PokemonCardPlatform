import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/providers/client-providers";
import { useSession } from "@/server/auth/session";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "PullVault | Live Collectible Drops",
  description: "Buy, open, and reveal collectible card packs in real time."
};

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
  const session = await useSession();

  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="preconnect" href="https://images.pokemontcg.io" crossOrigin="anonymous" />
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.pokemontcg.io" />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} />
      </head>
      <body className="font-sans">
        <ClientProviders initialSession={session.user}>{children}</ClientProviders>
      </body>
    </html>
  );
}
