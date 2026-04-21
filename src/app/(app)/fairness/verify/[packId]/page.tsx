"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  canonicalizeEligibleCardIdsByRarity,
  generateCanonicalPack,
  generateWeightedPack,
  type CanonicalGeneratedCard,
  type CanonicalTestVectorFixture,
  type WeightedSlotDistribution
} from "@/lib/fairness/hmac-draws";
import { FAIRNESS_UNIQUE_FIRST_ATTEMPTS } from "@/lib/fairness/constants";
import {
  getVerificationStatusLabel,
  type FairnessVerificationStatus,
  shouldShowLegacyBanner,
  shouldShowUnrevealedBanner
} from "@/lib/fairness/verifier-ui";
import { apiClient } from "@/lib/api-client";
import { buttonClassName } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import type { PackTier, RarityTier, SlotDistribution } from "@/lib/types";

type FairnessPackPayload = {
  packId: string;
  dropId: string;
  tier: PackTier;
  purchasedAt: string;
  verificationStatus: FairnessVerificationStatus;
  verificationError: string | null;
  generationVersion: {
    id: string;
    versionNumber: number;
    algorithmVersion: string;
    payload: {
      weightsByTier: Record<PackTier, { cardsPerPack: number; slots: SlotDistribution[][] }>;
      eligibleCardIdsByTier: Record<PackTier, Record<RarityTier, string[]>>;
    };
  } | null;
  commitment: {
    serverSeedId: string;
    serverSeedHashAtCommit: string;
    clientSeed: string;
    nonce: string;
    committedAt: string;
  } | null;
  seed: {
    seedHash: string;
    revealedAt: string | null;
    seedValue: string | null;
  } | null;
  cards: Array<{
    slotNumber: number;
    rarityTier: RarityTier;
    pokemonCardId: string;
  }>;
};

type PackApiResponse = {
  pack: FairnessPackPayload;
};

type VectorApiResponse = {
  vector: CanonicalTestVectorFixture;
};

type SlotVerification = {
  slotNumber: number;
  expected: CanonicalGeneratedCard | null;
  actual: FairnessPackPayload["cards"][number] | null;
  pass: boolean;
};

type VerificationState = {
  loading: boolean;
  error: string | null;
  vectorSanityPass: boolean;
  vectorSanityError: string | null;
  pack: FairnessPackPayload | null;
  slotChecks: SlotVerification[];
  overallPass: boolean;
};

function emptyState(): VerificationState {
  return {
    loading: true,
    error: null,
    vectorSanityPass: false,
    vectorSanityError: null,
    pack: null,
    slotChecks: [],
    overallPass: false
  };
}

function compareCard(a: CanonicalGeneratedCard | null, b: FairnessPackPayload["cards"][number] | null): boolean {
  if (!a || !b) {
    return false;
  }
  return a.slotNumber === b.slotNumber && a.rarityTier === b.rarityTier && a.pokemonCardId === b.pokemonCardId;
}

function buildSlotChecks(expectedCards: CanonicalGeneratedCard[], actualCards: FairnessPackPayload["cards"]): SlotVerification[] {
  const expectedBySlot = new Map(expectedCards.map((card) => [card.slotNumber, card]));
  const actualBySlot = new Map(actualCards.map((card) => [card.slotNumber, card]));

  const slotNumbers = Array.from(new Set([...expectedBySlot.keys(), ...actualBySlot.keys()])).sort((a, b) => a - b);
  return slotNumbers.map((slotNumber) => {
    const expected = expectedBySlot.get(slotNumber) ?? null;
    const actual = actualBySlot.get(slotNumber) ?? null;
    return {
      slotNumber,
      expected,
      actual,
      pass: compareCard(expected, actual)
    };
  });
}

async function runCanonicalSanity(vector: CanonicalTestVectorFixture): Promise<void> {
  const generated = await generateCanonicalPack({
    tier: vector.tier,
    serverSeedHex: vector.inputs.serverSeedHex,
    clientSeedHex: vector.inputs.clientSeedHex,
    nonce: BigInt(vector.inputs.nonce),
    slots: vector.inputs.slots,
    eligibleCardIdsByRarity: vector.inputs.eligibleCardIdsByRarity,
    enforceUniqueCards: vector.inputs.enforceUniqueCards
  });

  const cardsMatch = JSON.stringify(generated.cards) === JSON.stringify(vector.expected.cards);
  const transcriptMatch = JSON.stringify(generated.drawTranscript) === JSON.stringify(vector.expected.drawTranscript);
  const counterMatch = generated.drawCounterConsumed.toString() === vector.expected.drawCounterConsumed;

  if (!cardsMatch || !transcriptMatch || !counterMatch) {
    throw new Error("Canonical test vector sanity check failed.");
  }
}

async function verifyPackLocally(pack: FairnessPackPayload): Promise<{
  slotChecks: SlotVerification[];
  overallPass: boolean;
}> {
  if (pack.verificationStatus !== "VERIFIABLE") {
    return { slotChecks: [], overallPass: false };
  }

  if (!pack.generationVersion || !pack.commitment || !pack.seed?.seedValue) {
    throw new Error("Verifiable pack is missing required fairness artifacts.");
  }

  const tierWeights = pack.generationVersion.payload.weightsByTier[pack.tier];
  const tierEligible = pack.generationVersion.payload.eligibleCardIdsByTier[pack.tier];

  if (!tierWeights || !tierEligible) {
    throw new Error("Generation version payload is missing tier configuration.");
  }

  const generated = await generateWeightedPack({
    tier: pack.tier,
    serverSeedHex: pack.seed.seedValue,
    clientSeedHex: pack.commitment.clientSeed,
    nonce: BigInt(pack.commitment.nonce),
    slots: tierWeights.slots as WeightedSlotDistribution[][],
    eligibleCardIdsByRarity: canonicalizeEligibleCardIdsByRarity(tierEligible),
    enforceUniqueCards: true,
    uniqueFirstAttempts: FAIRNESS_UNIQUE_FIRST_ATTEMPTS,
    allowDuplicateFallback: true
  });

  const slotChecks = buildSlotChecks(generated.cards, pack.cards);
  const overallPass = slotChecks.length > 0 && slotChecks.every((entry) => entry.pass);
  return { slotChecks, overallPass };
}

export default function FairnessVerifierPage({ params }: { params: { packId: string } }): JSX.Element {
  const [state, setState] = useState<VerificationState>(() => emptyState());

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      setState(emptyState());
      try {
        const [vectorResponse, packResponse] = await Promise.all([
          apiClient.getFairnessTestVector(),
          apiClient.getFairnessPack(params.packId)
        ]);

        const vectorPayload = vectorResponse as VectorApiResponse;
        const packPayload = packResponse as PackApiResponse;

        let vectorSanityPass = false;
        let vectorSanityError: string | null = null;
        try {
          await runCanonicalSanity(vectorPayload.vector);
          vectorSanityPass = true;
        } catch (error) {
          vectorSanityError = error instanceof Error ? error.message : "Canonical sanity check failed.";
        }

        let slotChecks: SlotVerification[] = [];
        let overallPass = false;
        try {
          const verified = await verifyPackLocally(packPayload.pack);
          slotChecks = verified.slotChecks;
          overallPass = verified.overallPass;
        } catch (error) {
          if (packPayload.pack.verificationStatus === "VERIFIABLE") {
            throw error;
          }
        }

        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            vectorSanityPass,
            vectorSanityError,
            pack: packPayload.pack,
            slotChecks,
            overallPass
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          loading: false,
          error: error instanceof Error ? error.message : "Verification failed.",
          vectorSanityPass: false,
          vectorSanityError: null,
          pack: null,
          slotChecks: [],
          overallPass: false
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [params.packId]);

  const passCount = useMemo(() => state.slotChecks.filter((entry) => entry.pass).length, [state.slotChecks]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Fairness Verifier</h1>
          <p className="mt-1 text-sm text-slate-600">Pack {params.packId.slice(0, 8)} deterministic verification report.</p>
        </div>
        <Link
          href={routes.drops.index}
          className={buttonClassName({ variant: "secondary" })}
        >
          Back to drops
        </Link>
      </div>

      {state.loading ? <p className="text-sm font-medium text-slate-600">Running local verifier...</p> : null}
      {state.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{state.error}</p> : null}

      {!state.loading && !state.error ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">Sanity Check</h2>
            <p className={`mt-2 text-sm font-semibold ${state.vectorSanityPass ? "text-emerald-700" : "text-rose-700"}`}>
              {state.vectorSanityPass ? "Canonical vector check passed in browser." : "Canonical vector check failed."}
            </p>
            {state.vectorSanityError ? (
              <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs font-medium text-rose-700">{state.vectorSanityError}</p>
            ) : null}
          </section>

          {state.pack ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-black text-slate-900">Pack Status</h2>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase text-white">
                  {state.pack ? getVerificationStatusLabel(state.pack.verificationStatus) : "Loading"}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tier</p>
                  <p className="text-sm font-bold text-slate-900">{state.pack.tier}</p>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Purchased</p>
                  <p className="text-sm font-bold text-slate-900">{new Date(state.pack.purchasedAt).toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Commitment Nonce</p>
                  <p className="text-sm font-bold text-slate-900">{state.pack.commitment?.nonce ?? "N/A"}</p>
                </div>
              </div>

              {state.pack.verificationError ? (
                <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm font-medium text-rose-700">{state.pack.verificationError}</p>
              ) : null}

              {shouldShowLegacyBanner(state.pack.verificationStatus) ? (
                <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm font-medium text-amber-800">
                  This pack predates fairness commitments and cannot be deterministically verified.
                </p>
              ) : null}

              {shouldShowUnrevealedBanner(state.pack.verificationStatus) ? (
                <p className="mt-3 rounded-lg bg-sky-50 p-2 text-sm font-medium text-sky-800">
                  Seed is not revealed yet. Verification will be possible after drop completion.
                </p>
              ) : null}
            </section>
          ) : null}

          {state.slotChecks.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-black text-slate-900">Per-slot Verification</h2>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                    state.overallPass ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"
                  }`}
                >
                  {state.overallPass ? "overall pass" : "overall fail"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Matched slots: {passCount}/{state.slotChecks.length}
              </p>

              <div className="mt-4 space-y-2">
                {state.slotChecks.map((slot) => (
                  <div
                    key={slot.slotNumber}
                    className={`rounded-xl border p-3 ${
                      slot.pass ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">Slot {slot.slotNumber}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                          slot.pass ? "bg-emerald-200 text-emerald-900" : "bg-rose-200 text-rose-900"
                        }`}
                      >
                        {slot.pass ? "pass" : "fail"}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-white/70 p-2">
                        <p className="font-semibold text-slate-700">Expected</p>
                        <p className="text-slate-800">
                          {slot.expected
                            ? `${slot.expected.rarityTier} / ${slot.expected.pokemonCardId.slice(0, 8)}`
                            : "missing"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/70 p-2">
                        <p className="font-semibold text-slate-700">Actual</p>
                        <p className="text-slate-800">
                          {slot.actual ? `${slot.actual.rarityTier} / ${slot.actual.pokemonCardId.slice(0, 8)}` : "missing"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
