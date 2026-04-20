"use client";

import { AdminToolCard } from "@/components/admin/admin-tool-card";
import { StatusPanel } from "@/components/admin/status-panel";
import { useAuth } from "@/hooks/use-auth";

export default function AdminLandingPage(): JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return <StatusPanel title="Loading…" message="Checking your session." />;
  }

  if (!user) {
    return (
      <StatusPanel
        title="Admin"
        message="Sign in with an admin account to continue."
        action={{ label: "Go to login", href: "/login" }}
      />
    );
  }

  if (user.role !== "admin") {
    return (
      <StatusPanel
        title="Forbidden"
        message="Your account is not authorized to access admin tools."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-indigo-600">
          Admin · tools
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Admin</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <AdminToolCard
          title="Economics"
          description="Revenue streams, pack margin, per-tier EV, and integrity."
          href="/admin/economics"
        />
        <AdminToolCard
          title="Auction Flags"
          description="Review open auction abuse/suspicion flags and resolve triage outcomes."
          href="/admin/auction-flags"
        />
      </section>
    </div>
  );
}
