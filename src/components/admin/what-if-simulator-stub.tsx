"use client";

import { useState } from "react";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import type { EconomicsSimulation, PackEconomicsBundle } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { formatMoneyCents, formatPercentBps, formatPlainPercentBps } from "@/lib/format";

type WhatIfSimulatorStubProps = {
  bundle: PackEconomicsBundle;
};

const DEFAULT_ULTRA = 0.1;
const DEFAULT_CHASE = 0.04;

export function WhatIfSimulatorStub({ bundle: _bundle }: WhatIfSimulatorStubProps): JSX.Element {
  const [anchorScale, setAnchorScale] = useState(1);
  const [ultraRareMaxWeight, setUltraRareMaxWeight] = useState(DEFAULT_ULTRA);
  const [chaseMaxWeight, setChaseMaxWeight] = useState(DEFAULT_CHASE);
  const [eliteEdgeOverride, setEliteEdgeOverride] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<EconomicsSimulation | null>(null);

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

  const resetKnobs = (): void => {
    setAnchorScale(1);
    setUltraRareMaxWeight(DEFAULT_ULTRA);
    setChaseMaxWeight(DEFAULT_CHASE);
    setEliteEdgeOverride("");
    setSimulation(null);
    setSimulationError(null);
  };

  const missingPrices = simulation
    ? Object.values(simulation.anchorSnapshotMeta.byRarity).reduce(
        (sum, rarityMeta) => sum + rarityMeta.missingPriceCount,
        0
      )
    : 0;

  return (
    <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-pv-h3">What-if simulator</div>
          <p className="mt-0.5 text-[12px] text-pv-muted">
            Solver · deterministic 10k rolls / tier · live price anchors · v3.3 scope-narrowed pre-check
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={resetKnobs}>
            Reset
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={simulating}
            onClick={() => void runSimulation()}
          >
            {simulating ? "Running…" : "Run projection"}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* KNOBS */}
        <div className="rounded-pv border border-pv-line bg-pv-surface-3 p-4 space-y-3">
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Anchor scale
              </label>
              <span className="tabular-nums text-[12px] text-pv-text">{anchorScale.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={anchorScale}
              onChange={(event) => setAnchorScale(Number(event.target.value))}
              className="mt-1 w-full accent-pv-gold"
            />
            <p className="mt-1 text-[11px] text-pv-muted">
              {anchorScale === 1 ? "1.0× (live current price)" : `${anchorScale.toFixed(2)}× anchor`}
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Ultra-rare max weight
              </label>
              <span className="tabular-nums text-[12px] text-pv-text">
                {ultraRareMaxWeight.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={ultraRareMaxWeight}
              onChange={(event) => setUltraRareMaxWeight(Number(event.target.value))}
              className="mt-1 w-full accent-pv-gold"
            />
            <p className="mt-1 text-[11px] text-pv-muted">
              {ultraRareMaxWeight.toFixed(2)} (default {DEFAULT_ULTRA.toFixed(2)})
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Chase max weight
              </label>
              <span className="tabular-nums text-[12px] text-pv-text">
                {chaseMaxWeight.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.25}
              step={0.01}
              value={chaseMaxWeight}
              onChange={(event) => setChaseMaxWeight(Number(event.target.value))}
              className="mt-1 w-full accent-pv-gold"
            />
            <p className="mt-1 text-[11px] text-pv-muted">
              {chaseMaxWeight.toFixed(2)} (default {DEFAULT_CHASE.toFixed(2)})
            </p>
          </div>

          <hr className="border-pv-line" />

          <div>
            <label
              htmlFor="wif-elite-edge"
              className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2"
            >
              Target edge override · Elite
            </label>
            <input
              id="wif-elite-edge"
              value={eliteEdgeOverride}
              onChange={(event) => setEliteEdgeOverride(event.target.value)}
              placeholder="30.9%"
              className="mt-1 w-full min-h-9 rounded-[10px] border border-pv-line bg-pv-surface-2 px-3 py-1.5 text-[13px] text-pv-text outline-none transition focus:border-pv-line-strong"
            />
            <p className="mt-1 text-[11px] text-pv-muted">
              Leave blank to use tier default (display only).
            </p>
          </div>
        </div>

        {/* RESULT */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral">
              <span className="font-mono">
                anchor source · {simulation ? simulation.anchorSource : "live_current_price_eligible_catalog"}
              </span>
            </Chip>
            <Chip tone="neutral">
              <span className="font-mono">missing prices · {missingPrices}</span>
            </Chip>
          </div>

          {simulationError ? (
            <p
              role="alert"
              className="mt-3 rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-2 text-[12px] font-semibold text-[#fca5a5]"
            >
              {simulationError}
            </p>
          ) : null}

          {simulation ? (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {simulation.tiers.map((tier) => {
                const pass = tier.constraintsSatisfied && tier.edgeDeltaBps >= 0;
                return (
                  <div
                    key={tier.tier}
                    className={`rounded-pv border p-4 ${
                      pass
                        ? "border-pv-line bg-pv-surface-3"
                        : "border-pv-accent/35 bg-[rgba(239,68,68,0.04)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-pv-h3 capitalize">{tier.tier}</div>
                      <Chip tone={pass ? "good" : "danger"}>
                        {pass ? "Pass" : "Constraint fail"}
                      </Chip>
                    </div>
                    <p
                      className={`mt-1 text-[12px] ${
                        pass ? "text-pv-muted" : "text-pv-accent"
                      }`}
                    >
                      target {formatPlainPercentBps(tier.targetEdgeBps)} · achieved{" "}
                      {formatPlainPercentBps(tier.achievedEdgeBps)} · Δ {formatPercentBps(tier.edgeDeltaBps)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                          mean EV
                        </div>
                        <div
                          className={`font-extrabold tabular-nums ${pass ? "text-pv-text" : "text-pv-accent"}`}
                        >
                          {formatMoneyCents(Math.round(tier.meanEV))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                          win rate
                        </div>
                        <div className="font-extrabold tabular-nums text-pv-text">
                          {(tier.winRate * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                          p50
                        </div>
                        <div className="font-extrabold tabular-nums text-pv-text">
                          {formatMoneyCents(Math.round(tier.p50))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-pv-muted">
              Click <span className="font-semibold text-pv-text">Run projection</span> to generate
              per-tier EV distribution and achieved edge.
            </p>
          )}

          {simulation ? (
            <div className="mt-3 rounded-pv-sm border border-pv-info/30 bg-[rgba(56,189,248,0.06)] px-3 py-2 text-[12px] text-pv-info">
              <strong className="text-pv-info">Hint</strong>
              <span className="text-pv-muted">
                {" "}
                · Lowering <span className="font-mono">ultraRareMaxWeight</span> by 0.02 typically
                recovers Elite edge by ~2-4pp (run projection to confirm).
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
