"use client";

import { StatusPanel } from "@/components/admin/status-panel";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";

export default function AdminDropsPage(): JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return <StatusPanel title="Loading..." message="Checking your session." />;
  }

  if (!user) {
    return (
      <StatusPanel
        title="Admin Drops"
        message="Sign in with an admin account to access drop scheduling tools."
        action={{ label: "Go to login", href: routes.auth.login }}
      />
    );
  }

  if (user.role !== "admin") {
    return <StatusPanel title="Forbidden" message="Your account is not authorized to access admin drops." />;
  }

  return (
    <StatusPanel
      title="Admin Drops"
      message="Drop scheduling and pack composition controls are planned for Phase 7."
    />
  );
}
