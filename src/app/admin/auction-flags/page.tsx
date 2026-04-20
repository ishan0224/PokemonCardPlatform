"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import type { AuctionFlagResolution, AuctionFlagReviewItem } from "@/lib/types";
import { StatusPanel } from "@/components/admin/status-panel";
import { useAuth } from "@/hooks/use-auth";

type FlagFilter = "open" | "resolved" | "all";

export default function AdminAuctionFlagsPage(): JSX.Element {
  const { user, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<FlagFilter>("open");
  const [flags, setFlags] = useState<AuctionFlagReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadFlags = useCallback(async (selectedFilter: FlagFilter): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.listAuctionFlags({
        status: selectedFilter,
        limit: 200
      });
      setFlags(result.flags);
    } catch (loadError) {
      setError(mapApiErrorToMessage(loadError) || "Failed to load auction flags.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") {
      return;
    }
    void loadFlags(filter);
  }, [user, filter, loadFlags]);

  const handleResolve = useCallback(
    async (flagId: string, resolution: AuctionFlagResolution): Promise<void> => {
      setResolvingId(flagId);
      setError(null);
      try {
        await apiClient.resolveAuctionFlag(flagId, resolution);
        await loadFlags(filter);
      } catch (resolveError) {
        setError(mapApiErrorToMessage(resolveError) || "Failed to resolve auction flag.");
      } finally {
        setResolvingId(null);
      }
    },
    [filter, loadFlags]
  );

  if (authLoading) {
    return <StatusPanel title="Loading…" message="Checking your session." />;
  }

  if (!user) {
    return (
      <StatusPanel
        title="Auction Flags"
        message="Sign in with an admin account to view auction flags."
        action={{ label: "Go to login", href: "/login" }}
      />
    );
  }

  if (user.role !== "admin") {
    return <StatusPanel title="Forbidden" message="Your account is not authorized to review auction flags." />;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-indigo-600">
          Admin · auction flags
        </p>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">Auction Flag Review</h1>
        <p className="text-sm text-slate-600">
          Review and resolve open auction flags. Authoritative state lives in Postgres.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(["open", "resolved", "all"] as const).map((option) => {
          const active = option === filter;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                active
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Loading flags…
        </div>
      ) : null}

      {!loading && flags.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          No flags found for the selected filter.
        </div>
      ) : null}

      {!loading && flags.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Flag</th>
                <th className="px-4 py-3 text-left font-semibold">Auction</th>
                <th className="px-4 py-3 text-left font-semibold">Created</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Evidence</th>
                <th className="px-4 py-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {flags.map((flag) => {
                const isResolved = flag.resolvedAtIso !== null;
                return (
                  <tr key={flag.id}>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-slate-900">{flag.flagType}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">{flag.id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/auctions/${flag.auctionId}`}
                        className="font-mono text-xs text-indigo-700 underline decoration-indigo-300 underline-offset-2"
                      >
                        {flag.auctionId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{flag.createdAtIso}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                          isResolved
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {isResolved ? flag.resolution ?? "resolved" : "open"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <pre className="max-w-[360px] overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                        {JSON.stringify(flag.evidence, null, 2)}
                      </pre>
                    </td>
                    <td className="px-4 py-3">
                      {isResolved ? (
                        <span className="text-xs text-slate-500">Resolved</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={resolvingId === flag.id}
                            onClick={() => void handleResolve(flag.id, "dismissed")}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            disabled={resolvingId === flag.id}
                            onClick={() => void handleResolve(flag.id, "actioned")}
                            className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Actioned
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
