"use client";

import Link from "next/link";
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
import { StatusPanel } from "@/components/admin/status-panel";
import { WorstPacksList } from "@/components/admin/worst-packs-list";
import { WhatIfSimulatorStub } from "@/components/admin/what-if-simulator-stub";
import { Button } from "@/components/ui/button";
import { formatPlainPercentBps } from "@/lib/format";
import { routes } from "@/lib/routes";
import { RARITY_TIERS } from "@/lib/types";

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
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-indigo-600">
          Platform Economics · live
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Command Center</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sourced from <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">platform_revenue</span> and{" "}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">transactions</span> with live rarity anchors from{" "}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">pokemon_cards</span>.
        </p>
      </div>

      <EconomicsHeader
        preset={preset}
        fromIso={windowRange.fromIso}
        toIso={windowRange.toIso}
        onPresetChange={setPreset}
        onRefresh={handleRefresh}
        refreshing={state.loading}
      />

      {state.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {state.error}
        </div>
      ) : null}

      {state.loading && !canRender ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
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

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Rate-limit Denies · 24h</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                {state.bundle.rateLimitHitCount24h.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500">Live via admin:metrics coalescer</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Open Auction Flags</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                {state.bundle.openAuctionFlagCount.toLocaleString()}
              </p>
              <Link
                href={routes.admin.auctionFlags}
                className="mt-1 inline-block text-xs font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2"
              >
                Review list
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Margin Incidents · 24h</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                {state.bundle.marginIncidentCount24h.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                threshold ±{formatPlainPercentBps(state.bundle.incidentDeltaBps)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Verification Usage · 7d</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                {state.bundle.verificationUsageDistinctUsers7d.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500">Distinct users running fairness verification</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Fairness Audit</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">
                  Chi-squared goodness-of-fit
                </h2>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleFairnessRerun()}
                loading={rerunningFairness}
              >
                {rerunningFairness ? "Running…" : "Force rerun"}
              </Button>
            </div>

            {state.fairnessWarning ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {state.fairnessWarning}
              </p>
            ) : null}

            {state.fairnessOnDemandPreview ? (
              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                On-demand preview (approximate): p-value {state.fairnessOnDemandPreview.pValue.toFixed(6)} · χ²{" "}
                {state.fairnessOnDemandPreview.testStatistic.toFixed(4)} · df{" "}
                {state.fairnessOnDemandPreview.degreesOfFreedom}
              </div>
            ) : null}

            {authoritativeFairnessAudit ? (
              <>
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Authoritative audit source:{" "}
                  <span className="font-semibold">
                    {state.fairnessNightlyAudit ? "nightly" : `${authoritativeFairnessAudit.runSource} (fallback)`}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">Audit window</p>
                    <p className="mt-1 font-mono text-xs text-slate-800">
                      {authoritativeFairnessAudit.windowStartIso}
                    </p>
                    <p className="font-mono text-xs text-slate-800">{authoritativeFairnessAudit.windowEndIso}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">p-value</p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {authoritativeFairnessAudit.pValue.toFixed(6)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      χ²={authoritativeFairnessAudit.testStatistic.toFixed(4)} · df={authoritativeFairnessAudit.degreesOfFreedom}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">Run source</p>
                    <p className="mt-1 text-sm font-bold uppercase tracking-wide text-slate-900">
                      {authoritativeFairnessAudit.runSource}
                    </p>
                    <p className="text-[11px] text-slate-500">{authoritativeFairnessAudit.ranAtIso}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">Sample size</p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {authoritativeFairnessAudit.sampleSize.toLocaleString()} packs
                    </p>
                    <p className="text-[11px] text-slate-500">
                      MC applied: {authoritativeFairnessAudit.monteCarloApplied ? "yes" : "no"}
                    </p>
                    {authoritativeFairnessAudit.monteCarloApplied ? (
                      <p className="text-[11px] text-slate-500">
                        MC samples: {authoritativeFairnessAudit.monteCarloSamples?.toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-bold text-slate-900">Observed counts (per rarity)</h3>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {RARITY_TIERS.map((rarity) => (
                        <li key={`obs-${rarity}`} className="flex items-center justify-between">
                          <span className="font-mono text-xs uppercase text-slate-500">{rarity}</span>
                          <span className="tabular-nums">
                            {authoritativeFairnessAudit.observedCounts[rarity].toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-bold text-slate-900">Expected counts (per rarity)</h3>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {RARITY_TIERS.map((rarity) => (
                        <li key={`exp-${rarity}`} className="flex items-center justify-between">
                          <span className="font-mono text-xs uppercase text-slate-500">{rarity}</span>
                          <span className="tabular-nums">
                            {authoritativeFairnessAudit.expectedCounts[rarity].toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No fairness audit result yet. Run on-demand to create one.</p>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Drop Engagement</p>
              <p className="mt-2 text-sm text-slate-600">
                purchases/user avg{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.dropEngagement.purchasesPerUserAvg.toFixed(2)}
                </span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                sellout avg{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.dropEngagement.selloutTimeAvgSeconds === null
                    ? "n/a"
                    : `${Math.round(state.bundle.userHealth.dropEngagement.selloutTimeAvgSeconds)}s`}
                </span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                fill buckets · &lt;25% {state.bundle.userHealth.dropEngagement.dropfillDistribution.lt25} ·
                25-50% {state.bundle.userHealth.dropEngagement.dropfillDistribution.gte25Lt50} ·
                50-75% {state.bundle.userHealth.dropEngagement.dropfillDistribution.gte50Lt75} ·
                ≥75% {state.bundle.userHealth.dropEngagement.dropfillDistribution.gte75}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Auction Participation</p>
              <p className="mt-2 text-sm text-slate-600">
                bids/auction avg{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.auctionParticipation.bidsPerAuctionAvg.toFixed(2)}
                </span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                unique bidders/auction avg{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.auctionParticipation.uniqueBiddersPerAuctionAvg.toFixed(2)}
                </span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                watcher count avg: {state.bundle.userHealth.auctionParticipation.watcherCountAvg ?? "n/a"} (
                {state.bundle.userHealth.auctionParticipation.watcherCountMetricSource})
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Retention</p>
              <p className="mt-2 text-sm text-slate-600">
                cohort buyers{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.retention.cohortBuyerCount.toLocaleString()}
                </span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                D1 returning{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.retention.d1ReturningBuyerCount.toLocaleString()} (
                  {formatRate(state.bundle.userHealth.retention.d1Rate)})
                </span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                D7 returning{" "}
                <span className="font-semibold text-slate-900">
                  {state.bundle.userHealth.retention.d7ReturningBuyerCount.toLocaleString()} (
                  {formatRate(state.bundle.userHealth.retention.d7Rate)})
                </span>
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <RevenueTimeChart series={state.summary.hourlySeries} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <RevenueMixDonut summary={state.summary} />
            </div>
          </section>

          <PackTierTable tiers={state.bundle.tiers} portfolio={state.bundle.portfolio} />

          <WhatIfSimulatorStub bundle={state.bundle} />

          <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5 lg:flex">
              <WorstPacksList packs={state.bundle.worstPacks} />
            </div>
            <div className="lg:col-span-7 lg:flex">
              <TopAuctionsList auctions={state.bundle.topAuctions} />
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500">
            <p>
              Pack margin is the primary revenue lever. Showing theoretical vs actual house edge reframes the
              &ldquo;ripoff or sustainable&rdquo; question as a number you can defend — edge decreases by tier on purpose
              (commitment reward), and fees are a floor, not the ceiling.
            </p>
            {footerProvenance ? <span className="font-mono">{footerProvenance}</span> : null}
          </footer>
        </>
      ) : null}
    </div>
  );
}
