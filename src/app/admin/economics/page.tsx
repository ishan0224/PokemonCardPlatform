"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import type { EconomicsSummary, PackEconomicsBundle } from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";
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

const PRESET_DURATION_MS: Record<WindowPreset, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "31d": 31 * 24 * 60 * 60 * 1000
};

const INCIDENT_DELTA_BPS_DEFAULT = 1_000;

type EconomicsState = {
  summary: EconomicsSummary | null;
  bundle: PackEconomicsBundle | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
};

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
    loading: false,
    error: null,
    forbidden: false
  });

  const fetchData = useCallback(
    async (range: { fromIso: string; toIso: string }, signal?: AbortSignal): Promise<void> => {
      setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));
      try {
        const [summaryResult, packResult] = await Promise.all([
          apiClient.getEconomicsSummary(range, signal),
          apiClient.getPackEconomics(range, signal)
        ]);
        setState({
          summary: summaryResult.summary,
          bundle: packResult.bundle,
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
          loading: false,
          error: mapApiErrorToMessage(error) || "Failed to load economics data.",
          forbidden
        });
      }
    },
    []
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

  const canRender = state.summary !== null && state.bundle !== null;

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
        action={{ label: "Go to login", href: "/login" }}
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
            incidentDeltaBps={INCIDENT_DELTA_BPS_DEFAULT}
          />

          <EconomicsKpiStrip summary={state.summary} tiers={state.bundle.tiers} />

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
