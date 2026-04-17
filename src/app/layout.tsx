import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/ui/site-header";
import { AuthProvider } from "@/hooks/use-auth";

export const metadata: Metadata = {
  title: "PullVault | Live Collectible Drops",
  description: "Buy, open, and reveal collectible card packs in real time."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <AuthProvider>
          <div className="min-h-screen">
            <SiteHeader />
            <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
