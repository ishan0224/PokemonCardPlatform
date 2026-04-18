"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { usePortfolioRoom } from "./use-socket";

type AuthState = {
  user: {
    id: string;
    username: string;
    email: string;
    role: "user" | "admin";
  } | null;
  balance: {
    total: number;
    held: number;
    available: number;
  } | null;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  clearAuth: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [balance, setBalance] = useState<AuthState["balance"]>(null);
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async (): Promise<void> => {
    try {
      const result = await apiClient.me();
      setUser(result.user);
      setBalance(result.balance);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null);
        setBalance(null);
        return;
      }

      throw error;
    }
  }, []);

  const clearAuth = useCallback((): void => {
    setUser(null);
    setBalance(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      try {
        const result = await apiClient.me(controller.signal);
        if (!mounted) {
          return;
        }
        setUser(result.user);
        setBalance(result.balance);
      } catch (error) {
        if (!mounted) {
          return;
        }

        if (error instanceof ApiClientError && (error.status === 401 || error.code === "REQUEST_ABORTED")) {
          setUser(null);
          setBalance(null);
          return;
        }

        console.error("Failed to bootstrap auth state:", error);
        setUser(null);
        setBalance(null);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  usePortfolioRoom(user?.id ?? null, {
    onBalanceUpdate: (event) => {
      if (!user || event.userId !== user.id) {
        return;
      }

      setBalance({
        total: event.total,
        held: event.held,
        available: event.available
      });
    },
    onConnected: () => {
      void refreshAuth().catch((error) => {
        console.error("Failed to refresh auth after portfolio reconnect:", error);
      });
    }
  });

  const value = useMemo<AuthState>(
    () => ({
      user,
      balance,
      loading,
      refreshAuth,
      clearAuth
    }),
    [user, balance, loading, refreshAuth, clearAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
