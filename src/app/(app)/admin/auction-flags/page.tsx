"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import type { AuctionFlagResolution, AuctionFlagReviewItem } from "@/lib/types";
import { StatusPanel } from "@/components/admin/status-panel";
import { Button, buttonClassName } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { StatTile } from "@/components/ui/stat-tile";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";

type FlagFilter = "open" | "resolved" | "all";

function formatRelative(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const deltaSec = Math.max(0, (Date.now() - parsed.getTime()) / 1000);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  const days = Math.floor(deltaSec / 86400);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

function severityTone(flagType: string): "danger" | "upcoming" | "info" | "neutral" {
  if (flagType.includes("wash_trade") || flagType.includes("fraud")) return "danger";
  if (flagType.includes("throttle") || flagType.includes("bot")) return "upcoming";
  if (flagType.includes("watcher") || flagType.includes("spike")) return "info";
  return "neutral";
}

const CARD_IMG_BASE =
  "mb-2.5 flex items-center justify-center aspect-[5/7] rounded-pv-sm text-center text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2";

function flagCardGradient(flag: AuctionFlagReviewItem): string {
  const rarityHint = String(
    (flag.evidence?.rarity_tier as string | undefined) ??
      (flag.evidence?.rarityTier as string | undefined) ??
      ""
  );
  if (rarityHint === "chase") return `${CARD_IMG_BASE} pv-card-gradient-chase text-pv-gold`;
  if (rarityHint === "ultra_rare") return `${CARD_IMG_BASE} pv-card-gradient-ultra text-pv-r-ultra`;
  if (rarityHint === "holo_rare") return `${CARD_IMG_BASE} pv-card-gradient-holo text-pv-r-holo`;
  if (rarityHint === "rare") return `${CARD_IMG_BASE} pv-card-gradient-rare`;
  if (rarityHint === "uncommon") return `${CARD_IMG_BASE} pv-card-gradient-uncommon`;
  // Severity-driven fallback so we still show a rarity-styled thumb with no card metadata.
  if (flag.flagType.includes("wash_trade") || flag.flagType.includes("fraud")) {
    return `${CARD_IMG_BASE} pv-card-gradient-ultra text-pv-r-ultra`;
  }
  return `${CARD_IMG_BASE} pv-card-gradient-holo text-pv-r-holo`;
}

function cardDisplayLabel(flag: AuctionFlagReviewItem): string {
  const name = evidenceField(flag, ["card_name", "cardName"]);
  if (name) return name;
  return `Auction #${flag.auctionId.slice(0, 6)}`;
}

function cardSubLabel(flag: AuctionFlagReviewItem): string {
  const set = evidenceField(flag, ["set_name", "setName"]);
  const rarity = evidenceField(flag, ["rarity_tier", "rarityTier"]);
  if (set && rarity) return `${set} · ${rarity.replace("_", " ")}`;
  if (set) return set;
  if (rarity) return rarity.replace("_", " ");
  return "Flagged auction";
}

function evidenceField(flag: AuctionFlagReviewItem, keys: string[]): string | null {
  for (const key of keys) {
    const value = flag.evidence?.[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

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
    if (user?.role !== "admin") return;
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

  const openCount = useMemo(() => flags.filter((f) => f.resolvedAtIso === null).length, [flags]);
  const resolvedCount = useMemo(() => flags.filter((f) => f.resolvedAtIso !== null).length, [flags]);
  const dismissalRate = useMemo(() => {
    const resolved = flags.filter((f) => f.resolvedAtIso !== null);
    if (resolved.length === 0) return null;
    const dismissed = resolved.filter((f) => f.resolution === "dismissed").length;
    return Math.round((dismissed / resolved.length) * 100);
  }, [flags]);

  if (authLoading) return <StatusPanel title="Loading…" message="Checking your session." />;
  if (!user) {
    return (
      <StatusPanel
        title="Auction flags"
        message="Sign in with an admin account to view auction flags."
        action={{ label: "Go to login", href: routes.auth.login }}
      />
    );
  }
  if (user.role !== "admin") {
    return (
      <StatusPanel
        title="Forbidden"
        message="Your account is not authorised to review auction flags."
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Auction flag review</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Postgres is authoritative. Resolutions are audit-logged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatTile
            label="Open"
            value={<span className={openCount > 0 ? "text-pv-accent" : "text-pv-good"}>{openCount}</span>}
            tone={openCount > 0 ? "bad" : "good"}
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
          <StatTile
            label="Resolved · loaded"
            value={resolvedCount}
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
          <StatTile
            label="Dismissal rate"
            value={dismissalRate === null ? "—" : `${dismissalRate}%`}
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
        </div>
      </header>

      <Segmented
        value={filter}
        options={[
          { id: "open" as const, label: `Open (${openCount})` },
          { id: "resolved" as const, label: `Resolved (${resolvedCount})` },
          { id: "all" as const, label: "All" }
        ]}
        onChange={(next) => setFilter(next)}
        ariaLabel="Auction flag filter"
      />

      {error ? (
        <div
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm font-medium text-[#fca5a5]"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 px-4 py-6 text-sm text-pv-muted">
          Loading flags…
        </div>
      ) : null}

      {!loading && flags.length === 0 ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 px-4 py-6 text-sm text-pv-muted">
          No flags found for the selected filter.
        </div>
      ) : null}

      {!loading && flags.length > 0 ? (
        <div className="space-y-3">
          {flags.map((flag) => {
            const isResolved = flag.resolvedAtIso !== null;
            return (
              <article
                key={flag.id}
                className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={severityTone(flag.flagType)}>{flag.flagType}</Chip>
                    <Chip tone={isResolved ? "good" : "live"} pulse={!isResolved}>
                      {isResolved ? (flag.resolution ?? "resolved") : "Open"}
                    </Chip>
                    <span className="text-[12px] text-pv-muted">
                      Opened {formatRelative(flag.createdAtIso)} · auto-flagged
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-pv-muted-2">
                    flag · {flag.id.slice(0, 12)}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
                  {/* Left — card-img style thumb + meta (matches demo) */}
                  <div className="rounded-pv border border-pv-line bg-pv-surface-3 p-4">
                    <div className={flagCardGradient(flag)}>
                      <span>{cardDisplayLabel(flag)}</span>
                    </div>
                    <div className="text-[13px] font-bold text-pv-text">{cardDisplayLabel(flag)}</div>
                    <div className="text-[12px] text-pv-muted">
                      {cardSubLabel(flag)}
                    </div>
                    <div className="my-3 h-px bg-pv-line" />
                    <div className="space-y-1 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="text-pv-muted">Seller</span>
                        <span className="text-pv-text">{evidenceField(flag, ["seller_user_id", "sellerUsername"]) ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-pv-muted">Top bidder</span>
                        <span className="text-pv-accent">{evidenceField(flag, ["top_bidder_user_id", "topBidderUsername"]) ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-pv-muted">Auction</span>
                        <span className="font-mono text-pv-text">#{flag.auctionId.slice(0, 8)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-pv-muted">Current bid</span>
                        <span className="font-bold text-pv-text">
                          {evidenceField(flag, ["current_bid_label", "currentBidLabel"]) ?? "—"}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={routes.auctions.detail(flag.auctionId)}
                      className={`${buttonClassName({ variant: "secondary", size: "sm", fullWidth: true })} mt-3`}
                    >
                      Open auction →
                    </Link>
                  </div>

                  {/* Right — evidence + actions */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                        Automated evidence
                      </p>
                      <pre className="mt-1 max-h-[260px] overflow-x-auto overflow-y-auto rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3 text-[11px] text-pv-text">
                        {JSON.stringify(flag.evidence, null, 2)}
                      </pre>
                    </div>

                    {isResolved ? (
                      <p className="text-[12px] text-pv-muted">
                        Resolved · {flag.resolution ?? "resolved"}
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={resolvingId === flag.id}
                          onClick={() => void handleResolve(flag.id, "dismissed")}
                        >
                          Dismiss
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={resolvingId === flag.id}
                          onClick={() => void handleResolve(flag.id, "actioned")}
                        >
                          {resolvingId === flag.id ? "Resolving…" : "Actioned"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
