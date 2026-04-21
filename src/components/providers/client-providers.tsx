"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { AuthProvider } from "@/hooks/use-auth";

export function ClientProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        refreshInterval: 0,
        shouldRetryOnError: false,
        keepPreviousData: true
      }}
    >
      <AuthProvider>{children}</AuthProvider>
    </SWRConfig>
  );
}
