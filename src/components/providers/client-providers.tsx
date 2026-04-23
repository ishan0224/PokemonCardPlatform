"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
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
        revalidateOnFocus: false,
        refreshInterval: 0,
        shouldRetryOnError: false,
        keepPreviousData: true
      }}
    >
      <AuthProvider initialSession={initialSession}>{children}</AuthProvider>
    </SWRConfig>
  );
}
