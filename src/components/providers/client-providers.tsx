"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { NotificationsProvider } from "@/components/providers/notifications-provider";
import { AuthProvider } from "@/hooks/use-auth";
import type { ServerSessionUser } from "@/server/auth/session";

type ClientProvidersProps = {
  children: ReactNode;
  initialSession?: ServerSessionUser | null;
};

export function ClientProviders({ children, initialSession = null }: ClientProvidersProps): JSX.Element {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        refreshInterval: 0,
        shouldRetryOnError: false,
        keepPreviousData: true
      }}
    >
      <AuthProvider initialSession={initialSession}>
        <NotificationsProvider>{children}</NotificationsProvider>
      </AuthProvider>
    </SWRConfig>
  );
}
