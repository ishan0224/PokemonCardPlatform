"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import type {
  AdminMetricsDeltaEvent,
  EconomicsSummary,
  FairnessAuditResult,
  PackEconomicsBundle
} from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";
import { useAdminMetricsRoom } from "@/hooks/use-socket";
import { EconomicsHeader, type WindowPreset } from "@/components/admin/economics-header";
import { EconomicsIncidentBanner } from "@/components/admin/economics-incident-banner";
import { EconomicsKpiStrip } from "@/components/admin/economics-kpi-strip";
import { PackTierTable } from "@/components/admin/pack-tier-table";
import { RevenueMixDonut } from "@/components/admin/revenue-mix-donut";
import { RevenueTimeChart } from "@/components/admin/revenue-time-chart";
import { TopAuctionsList } from "@/components/admin/top-auctions-list";
import { IntegrityList } from "@/components/admin/integrity-list";
import { StatusPanel } from "@/components/admin/status-panel";
import { WorstPacksList } from "@/components/admin/worst-packs-list";
import { WhatIfSimulatorStub } from "@/components/admin/what-if-simulator-stub";
import { routes } from "@/lib/routes";

const PRESET_DURATION_MS: Record<WindowPreset, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "31d": 31 * 24 * 60 * 60 * 1000
};

type EconomicsState = {
  summary: EconomicsSummary | null;
  bundle: PackEconomicsBundle | null;
  fairnessLatestAudit: FairnessAuditResult | null;
  fairnessNightlyAudit: FairnessAuditResult | null;
  fairnessOnDemandPreview: FairnessAuditResult | null;
  fairnessWarning: string | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
};

function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function resolveWindow(preset: WindowPreset): { fromIso: string; toIso: string } {
  const toIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - PRESET_DURATION_MS[preset]).toISOString();
  return { fromIso, toIso };
}

export default function AdminEconomicsPage(): JSX.Element {
  const { user, loading: authLoading } = useAuth();
  const [preset, setPreset] = useState<WindowPreset>("24h");
  const [windowRange, setWindowRange] = useState(() => resolveWindow("24h"));
  const [state, setState] = useState<EconomicsState>({
    summary: null,
    bundle: null,
    fairnessLatestAudit: null,
    fairnessNightlyAudit: null,
    fairnessOnDemandPreview: null,
    fairnessWarning: null,
    loading: false,
    error: null,
    forbidden: false
  });
  const [rerunningFairness, setRerunningFairness] = useState(false);

  const loadFairnessAudit = useCallback(
    async (
      source: "latest" | "nightly",
      signal?: AbortSignal
    ): Promise<{ audit: FairnessAuditResult | null; warning: string | null }> => {
      try {
        const result = await apiClient.getFairnessAudit({ window: "7d", source }, signal);
        return { audit: result.audit, warning: null };
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404) {
          return { audit: null, warning: null };
        }
        throw error;
      }
    },
    []
  );

  const fetchData = useCallback(
    async (range: { fromIso: string; toIso: string }, signal?: AbortSignal): Promise<void> => {
      setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));
      try {
        const [summaryResult, packResult, fairnessLatestResult, fairnessNightlyResult] = await Promise.all([
          apiClient.getEconomicsSummary(range, signal),
          apiClient.getPackEconomics(range, signal),
          loadFairnessAudit("latest", signal),
          loadFairnessAudit("nightly", signal)
        ]);
        setState({
          summary: summaryResult.summary,
          bundle: packResult.bundle,
          fairnessLatestAudit: fairnessLatestResult.audit,
          fairnessNightlyAudit: fairnessNightlyResult.audit,
          fairnessOnDemandPreview: null,
          fairnessWarning: fairnessLatestResult.warning ?? fairnessNightlyResult.warning,
          loading: false,
          error: null,
          forbidden: false
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") {
          return;
        }
        const forbidden = error instanceof ApiClientError && (error.status === 401 || error.status === 403);
        setState({
          summary: null,
          bundle: null,
          fairnessLatestAudit: null,
          fairnessNightlyAudit: null,
          fairnessOnDemandPreview: null,
          fairnessWarning: null,
          loading: false,
          error: mapApiErrorToMessage(error) || "Failed to load economics data.",
          forbidden
        });
      }
    },
    [loadFairnessAudit]
  );

  useEffect(() => {
    if (!user) {
      return;
    }
    const controller = new AbortController();
    const range = resolveWindow(preset);
    setWindowRange(range);
    void fetchData(range, controller.signal);
    return () => controller.abort();
  }, [preset, user, fetchData]);

  const handleRefresh = useCallback((): void => {
    const range = resolveWindow(preset);
    setWindowRange(range);
    void fetchData(range);
  }, [preset, fetchData]);

  const handleFairnessRerun = useCallback(async (): Promise<void> => {
    setRerunningFairness(true);
    try {
      const result = await apiClient.rerunFairnessAudit();
      setState((prev) => ({
        ...prev,
        fairnessOnDemandPreview: result.audit,
        fairnessWarning: result.warning
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: mapApiErrorToMessage(error) || "Failed to rerun fairness audit."
      }));
    } finally {
      setRerunningFairness(false);
    }
  }, []);

  useAdminMetricsRoom(user?.role === "admin", {
    onMetricsDelta: (event: AdminMetricsDeltaEvent) => {
      setState((prev) => {
        if (!prev.bundle) {
          return prev;
        }

        return {
          ...prev,
          bundle: {
            ...prev.bundle,
            rateLimitHitCount24h: clampNonNegative(
              prev.bundle.rateLimitHitCount24h + event.rateLimitHitCountDelta
            ),
            openAuctionFlagCount: clampNonNegative(
              prev.bundle.openAuctionFlagCount + event.openAuctionFlagCountDelta
            ),
            marginIncidentCount24h: clampNonNegative(
              prev.bundle.marginIncidentCount24h + event.marginIncidentCountDelta
            )
          }
        };
      });
    },
    onConnected: () => {
      void fetchData(windowRange).catch((error) => {
        console.error("Failed to reconcile admin metrics after reconnect:", error);
      });
    }
  });

  const canRender = state.summary !== null && state.bundle !== null;
  const authoritativeFairnessAudit = state.fairnessNightlyAudit ?? state.fairnessLatestAudit;

  const footerProvenance = useMemo(() => {
    if (!state.summary) {
      return null;
    }
    return `source · platform_revenue (${state.summary.platformRevenueRowCount} rows) ⋈ transactions (${state.summary.transactionRowCount} rows) · ${state.summary.window.fromIso} → ${state.summary.window.toIso}`;
  }, [state.summary]);

  if (authLoading) {
    return <StatusPanel title="Loading…" message="Checking your session." />;
  }

  if (!user) {
    return (
      <StatusPanel
        title="Admin Economics"
        message="Sign in with an admin account to view platform economics."
        action={{ label: "Go to login", href: routes.auth.login }}
      />
    );
  }

  if (state.forbidden) {
    return (
      <StatusPanel
        title="Forbidden"
        message="Your account is not authorized to view platform economics."
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Economics</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Last 24h · window closes every hour. Revenue authority lives in Postgres; Redis is read-cache only.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-pv-surface-3 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-pv-muted">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-pv-good motion-safe:animate-pv-pulse"
          />
          Live · admin_metrics_delta
        </span>
      </header>

      <EconomicsHeader
        preset={preset}
        fromIso={windowRange.fromIso}
        toIso={windowRange.toIso}
        onPresetChange={setPreset}
        onRefresh={handleRefresh}
        refreshing={state.loading}
      />

      {state.error ? (
        <div
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-4 text-sm font-medium text-[#fca5a5]"
        >
          {state.error}
        </div>
      ) : null}

      {state.loading && !canRender ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-10 text-center text-sm text-pv-muted">
          Loading economics…
        </div>
      ) : null}

      {canRender && state.summary && state.bundle ? (
        <>
          <EconomicsIncidentBanner
            tiers={state.bundle.tiers}
            tiersLosingMoneyCount={state.bundle.integrity.tiersLosingMoneyCount}
            incidentDeltaBps={state.bundle.incidentDeltaBps}
          />

          <EconomicsKpiStrip summary={state.summary} tiers={state.bundle.tiers} />

          {/* DEMO SECTION: hourly bars + revenue mix donut */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
              <RevenueTimeChart series={state.summary.hourlySeries} />
            </div>
            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
              <RevenueMixDonut summary={state.summary} />
            </div>
          </section>

          {/* PACK TIER TABLE */}
          <PackTierTable tiers={state.bundle.tiers} portfolio={state.bundle.portfolio} />

          {/* DEMO SECTION: three-col top auctions / worst packs / integrity */}
          <section className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
            <TopAuctionsList auctions={state.bundle.topAuctions} />
            <WorstPacksList packs={state.bundle.worstPacks} />
            <IntegrityList integrity={state.bundle.integrity} />
          </section>

          {/* WHAT-IF SIMULATOR */}
          <WhatIfSimulatorStub bundle={state.bundle} />

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Drop engagement
              </p>
              <p className="mt-2 text-[13px] text-pv-muted">
                purchases/user avg{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.dropEngagement.purchasesPerUserAvg.toFixed(2)}
                </span>
              </p>
              <p className="mt-1 text-[13px] text-pv-muted">
                sellout avg{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.dropEngagement.selloutTimeAvgSeconds === null
                    ? "n/a"
                    : `${Math.round(state.bundle.userHealth.dropEngagement.selloutTimeAvgSeconds)}s`}
                </span>
              </p>
              <p className="mt-2 text-[11px] text-pv-muted">
                fill buckets · &lt;25% {state.bundle.userHealth.dropEngagement.dropfillDistribution.lt25}
                · 25-50% {state.bundle.userHealth.dropEngagement.dropfillDistribution.gte25Lt50} · 50-75%{" "}
                {state.bundle.userHealth.dropEngagement.dropfillDistribution.gte50Lt75} · ≥75%{" "}
                {state.bundle.userHealth.dropEngagement.dropfillDistribution.gte75}
              </p>
            </div>

            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Auction participation
              </p>
              <p className="mt-2 text-[13px] text-pv-muted">
                bids/auction avg{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.auctionParticipation.bidsPerAuctionAvg.toFixed(2)}
                </span>
              </p>
              <p className="mt-1 text-[13px] text-pv-muted">
                unique bidders/auction avg{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.auctionParticipation.uniqueBiddersPerAuctionAvg.toFixed(2)}
                </span>
              </p>
              <p className="mt-2 text-[11px] text-pv-muted">
                watcher count avg: {state.bundle.userHealth.auctionParticipation.watcherCountAvg ?? "n/a"}{" "}
                ({state.bundle.userHealth.auctionParticipation.watcherCountMetricSource})
              </p>
            </div>

            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Retention</p>
              <p className="mt-2 text-[13px] text-pv-muted">
                cohort buyers{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.retention.cohortBuyerCount.toLocaleString()}
                </span>
              </p>
              <p className="mt-1 text-[13px] text-pv-muted">
                D1 returning{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.retention.d1ReturningBuyerCount.toLocaleString()} (
                  {formatRate(state.bundle.userHealth.retention.d1Rate)})
                </span>
              </p>
              <p className="mt-1 text-[13px] text-pv-muted">
                D7 returning{" "}
                <span className="font-extrabold text-pv-text">
                  {state.bundle.userHealth.retention.d7ReturningBuyerCount.toLocaleString()} (
                  {formatRate(state.bundle.userHealth.retention.d7Rate)})
                </span>
              </p>
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-pv-line pt-4 text-[11px] text-pv-muted">
            <p className="max-w-[720px]">
              Pack margin is the primary revenue lever. Showing theoretical vs actual house edge reframes
              the &ldquo;ripoff or sustainable&rdquo; question as a number you can defend — edge decreases
              by tier on purpose (commitment reward), and fees are a floor, not the ceiling.
            </p>
            {footerProvenance ? <span className="font-mono">{footerProvenance}</span> : null}
          </footer>
        </>
      ) : null}
    </div>
  );
}
