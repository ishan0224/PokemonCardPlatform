"use client";

import { useState } from "react";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import type { EconomicsSimulation, PackEconomicsBundle, PackTierEconomics } from "@/lib/types";
import { formatMoneyCents, formatPercentBps, formatPlainPercentBps, formatSignedMoneyCents } from "@/lib/format";

type WhatIfSimulatorStubProps = {
  bundle: PackEconomicsBundle;
};

export function WhatIfSimulatorStub({ bundle }: WhatIfSimulatorStubProps): JSX.Element {
  const [anchorScale, setAnchorScale] = useState(1);
  const [ultraRareWeight, setUltraRareWeight] = useState(1.5);
  const [chaseCap, setChaseCap] = useState<0 | 1 | 2>(1);
  const [auctionFeeBps, setAuctionFeeBps] = useState(800);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<EconomicsSimulation | null>(null);

  const worstTier = bundle.tiers.reduce<PackTierEconomics | null>((acc, tier) => {
    if (tier.actualHouseEdgeBps === null) {
      return acc;
    }
    if (!acc || (acc.actualHouseEdgeBps ?? 0) > tier.actualHouseEdgeBps) {
      return tier;
    }
    return acc;
  }, null);

  const ultraRareMaxWeight = ultraRareWeight / 100;
  const chaseMaxWeight = chaseCap === 0 ? 0 : chaseCap === 1 ? 0.03 : 0.06;

  const runSimulation = async (): Promise<void> => {
    setSimulating(true);
    setSimulationError(null);

    try {
      const result = await apiClient.simulateEconomics({
        anchorScale,
        ultraRareMaxWeight,
        chaseMaxWeight
      });
      setSimulation(result);
    } catch (error) {
      setSimulationError(mapApiErrorToMessage(error) || "Failed to run economics simulation.");
    } finally {
      setSimulating(false);
    }
  };

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(280px,420px)]">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">What-if simulator</h2>
            <p className="mt-1 text-xs text-slate-500">
              Run `/api/admin/economics/simulate` with candidate knobs against current anchors.
            </p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            live
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <label className="font-semibold">Card anchor scale</label>
              <span className="tabular-nums text-slate-900">{anchorScale.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={2}
              step={0.01}
              value={anchorScale}
              onChange={(event) => setAnchorScale(Number(event.target.value))}
              className="mt-1 w-full accent-indigo-500"
            />
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              Multiplier applied to live rarity price anchors before simulation.
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between text-sm">
              <label className="font-semibold">Ultra-rare weight</label>
              <span className="tabular-nums text-slate-900">{ultraRareWeight.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={ultraRareWeight}
              onChange={(event) => setUltraRareWeight(Number(event.target.value))}
              className="mt-1 w-full accent-indigo-500"
            />
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              Applied as solver cap for ultra-rare slot weight.
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between text-sm">
              <label className="font-semibold">Chase cap per pack</label>
              <span className="tabular-nums text-slate-900">{chaseCap} card</span>
            </div>
            <div className="mt-2 flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
              {[0, 1, 2].map((option) => {
                const active = option === chaseCap;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setChaseCap(option as 0 | 1 | 2)}
                    className={`flex-1 rounded-md px-2 py-1 transition ${
                      active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between text-sm">
              <label className="font-semibold">Auction fee</label>
              <span className="tabular-nums text-slate-900">{(auctionFeeBps / 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1500}
              step={50}
              value={auctionFeeBps}
              onChange={(event) => setAuctionFeeBps(Number(event.target.value))}
              className="mt-1 w-full accent-indigo-500"
            />
            <div className="mt-1 font-mono text-[10px] text-slate-500">Displayed only. Fee tuning is outside Phase 3.</div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Projection preview</div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-700">
              solver output
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            Runs deterministic B1 simulation (10k rolls/tier) and returns EV distribution + projected margins.
          </p>
          <div className="mt-4 flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => void runSimulation()}
              disabled={simulating}
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {simulating ? "Running projection..." : "Run projection"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAnchorScale(1);
                setUltraRareWeight(1.5);
                setChaseCap(1);
                setAuctionFeeBps(800);
                setSimulation(null);
                setSimulationError(null);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold hover:bg-slate-50"
            >
              Reset
            </button>
          </div>

          {simulationError ? (
            <p className="mt-3 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700">{simulationError}</p>
          ) : null}

          {simulation ? (
            <div className="mt-4 space-y-2">
              <div className="rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                anchor source: <span className="font-mono">{simulation.anchorSource}</span> · missing prices{" "}
                <span className="font-semibold">
                  {Object.values(simulation.anchorSnapshotMeta.byRarity).reduce(
                    (sum, rarityMeta) => sum + rarityMeta.missingPriceCount,
                    0
                  )}
                </span>
              </div>
              {simulation.tiers.map((tier) => (
                <div key={tier.tier} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{tier.tier}</p>
                    <div className="flex items-center gap-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          tier.constraintsSatisfied ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {tier.constraintsSatisfied ? "feasible" : "constraint fail"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          tier.aggressiveEdgeWarning
                            ? "bg-amber-100 text-amber-800"
                            : tier.edgeDeltaBps < 0
                            ? "bg-rose-100 text-rose-800"
                            : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {tier.aggressiveEdgeWarning
                          ? `aggressive ${formatPercentBps(tier.edgeDeltaBps)}`
                          : tier.edgeDeltaBps < 0
                          ? `below ${formatPercentBps(tier.edgeDeltaBps)}`
                          : "target corridor"}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    mean EV {formatMoneyCents(Math.round(tier.meanEV))} · win rate {(tier.winRate * 100).toFixed(2)}% · p50{" "}
                    {formatMoneyCents(Math.round(tier.p50))}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    target {formatPlainPercentBps(tier.targetEdgeBps)} · achieved {formatPlainPercentBps(tier.achievedEdgeBps)} · delta{" "}
                    {formatPercentBps(tier.edgeDeltaBps)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-rose-600">leading suspect</span>
          <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
            engineering
          </span>
        </div>
        <h3 className="mt-2 text-base font-bold">
          {worstTier
            ? `${worstTier.displayName} actual edge ${formatPlainPercentBps(worstTier.actualHouseEdgeBps ?? 0)} vs ${formatPlainPercentBps(worstTier.targetHouseEdgeBps)} target.`
            : "Tier house edges are within configured corridor."}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Check rarity weights in <span className="font-mono">pack-tiers.ts</span> and card anchors in{" "}
          <span className="font-mono">pokemon_cards.current_price</span>. Fees reconcile at the BPS level in the
          integrity panel; the lever is pack economics.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <MetricCard label="Σ margin" value={formatSignedMoneyCents(bundle.portfolio.sigmaMarginCents)} />
          <MetricCard
            label="Edge gap"
            value={
              bundle.portfolio.actualHouseEdgeBps === null
                ? "—"
                : formatPlainPercentBps(bundle.portfolio.actualHouseEdgeBps - bundle.portfolio.theoreticalHouseEdgeBps)
            }
          />
          <MetricCard
            label="Worst pack"
            value={
              worstTier && worstTier.worstMarginCents !== null
                ? formatMoneyCents(Math.abs(worstTier.worstMarginCents))
                : "—"
            }
          />
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
