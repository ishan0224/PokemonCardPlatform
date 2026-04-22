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
import { CardImage } from "@/components/ui/card-image";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { formatMoneyCents, formatTierLabel } from "@/lib/format";
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
    pokemonCard: {
      name: string;
      imageUrl: string | null;
      imageUrlHires: string | null;
      currentPrice: number;
    };
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
  const cardMetaById = useMemo(() => {
    const cards = state.pack?.cards ?? [];
    return new Map(cards.map((card) => [card.pokemonCardId, card.pokemonCard]));
  }, [state.pack?.cards]);

  const pack = state.pack;
  const headerTone = state.overallPass
    ? "border-pv-good/30 bg-gradient-to-b from-[rgba(16,185,129,0.06)] to-transparent"
    : "border-pv-line bg-pv-surface-2";

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[12px]">
          <Link href={routes.fairness.verifyIndex} className="text-pv-muted hover:text-pv-text">
            ← Verify
          </Link>
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Pack #{params.packId.slice(0, 8)}
          </span>
        </div>
      </div>

      {state.loading ? <p className="text-sm font-medium text-pv-muted">Running local verifier…</p> : null}
      {state.error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-sm font-medium text-[#fca5a5]"
        >
          {state.error}
        </p>
      ) : null}

      {!state.loading && !state.error && pack ? (
        <>
          {/* RESULT CARD */}
          <section className={`rounded-pv-lg border p-5 ${headerTone}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                  Result
                </p>
                <h1 className="mt-1 text-pv-h2">
                  Overall:{" "}
                  <span className={state.overallPass ? "text-pv-good" : "text-pv-accent"}>
                    {state.overallPass ? "PASS" : shouldShowUnrevealedBanner(pack.verificationStatus) ? "PENDING" : "FAIL"}
                  </span>
                  {state.slotChecks.length > 0 ? (
                    <span className="text-pv-muted">
                      {" "}
                      · {passCount} of {state.slotChecks.length} slots match
                    </span>
                  ) : null}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {pack.commitment ? <Chip tone="neutral">Nonce · {pack.commitment.nonce}</Chip> : null}
                {pack.seed?.revealedAt ? (
                  <Chip tone="good">Server seed · revealed</Chip>
                ) : (
                  <Chip tone="neutral">Server seed · pending</Chip>
                )}
                {pack.generationVersion ? (
                  <Chip tone="gold">Algorithm · {pack.generationVersion.algorithmVersion}</Chip>
                ) : null}
              </div>
            </div>

            {shouldShowLegacyBanner(pack.verificationStatus) ? (
              <p className="mt-3 rounded-pv-sm border border-pv-warn/28 bg-[rgba(245,158,11,0.08)] p-3 text-sm font-medium text-pv-warn">
                This pack predates fairness commitments and cannot be deterministically verified.
              </p>
            ) : null}
            {shouldShowUnrevealedBanner(pack.verificationStatus) ? (
              <p className="mt-3 rounded-pv-sm border border-pv-info/28 bg-[rgba(56,189,248,0.06)] p-3 text-sm font-medium text-pv-info">
                Seed is not revealed yet. Verification will be possible after drop completion.
              </p>
            ) : null}
            {pack.verificationError ? (
              <p className="mt-3 rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-sm font-medium text-[#fca5a5]">
                {pack.verificationError}
              </p>
            ) : null}
          </section>

          {/* PACK META */}
          <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-pv-h3">Pack status</h2>
              <Chip tone={pack.verificationStatus === "VERIFIABLE" ? "good" : "neutral"}>
                {getVerificationStatusLabel(pack.verificationStatus)}
              </Chip>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-pv-sm bg-pv-surface-3 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Tier</p>
                <p className="text-[14px] font-bold text-pv-text">{formatTierLabel(pack.tier)}</p>
              </div>
              <div className="rounded-pv-sm bg-pv-surface-3 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Purchased</p>
                <p className="text-[13px] font-bold text-pv-text">
                  {new Date(pack.purchasedAt).toLocaleString()}
                </p>
              </div>
              <div className="rounded-pv-sm bg-pv-surface-3 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                  Commitment nonce
                </p>
                <p className="mono text-[13px] font-bold text-pv-text">
                  {pack.commitment?.nonce ?? "N/A"}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
              <p
                className={`text-[13px] font-semibold ${
                  state.vectorSanityPass ? "text-pv-good" : "text-pv-accent"
                }`}
              >
                Sanity check:{" "}
                {state.vectorSanityPass
                  ? "canonical vector check passed in browser."
                  : "canonical vector check failed."}
              </p>
              {state.vectorSanityError ? (
                <p className="mt-1 text-[12px] text-pv-accent">{state.vectorSanityError}</p>
              ) : null}
            </div>
          </section>

          {/* PER-SLOT TABLE */}
          {state.slotChecks.length > 0 ? (
            <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-pv-h3">Per-slot verification</h2>
                <p className="text-[12px] text-pv-muted">
                  Matched slots: {passCount}/{state.slotChecks.length}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                      <th className="border-b border-pv-line px-2 py-2">Slot</th>
                      <th className="border-b border-pv-line px-2 py-2">Expected</th>
                      <th className="border-b border-pv-line px-2 py-2">Actual</th>
                      <th className="border-b border-pv-line px-2 py-2">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.slotChecks.map((slot) => {
                      const expectedCardMeta = slot.expected
                        ? cardMetaById.get(slot.expected.pokemonCardId) ?? null
                        : null;
                      const actualCardMeta = slot.actual?.pokemonCard ?? null;
                      const isFeature =
                        slot.actual?.rarityTier === "ultra_rare" ||
                        slot.actual?.rarityTier === "chase";
                      return (
                        <tr
                          key={slot.slotNumber}
                          className="border-b border-pv-line last:border-b-0"
                        >
                          <td className="px-2 py-3 font-bold text-pv-text">
                            {slot.slotNumber}
                            {isFeature ? (
                              <span className="ml-1 text-[11px] font-semibold text-pv-gold">
                                · feature
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-3">
                            {slot.expected ? (
                              <div className="flex items-center gap-2">
                                {expectedCardMeta ? (
                                  <CardImage
                                    src={expectedCardMeta.imageUrl}
                                    hiresSrc={expectedCardMeta.imageUrlHires}
                                    alt={expectedCardMeta.name}
                                    size="sm"
                                    rarityTier={slot.expected.rarityTier}
                                  />
                                ) : null}
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-bold text-pv-text">
                                    {expectedCardMeta?.name ?? slot.expected.pokemonCardId.slice(0, 8)}
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px] text-pv-muted">
                                    <RarityBadge rarity={slot.expected.rarityTier} compact />
                                    <span className="font-mono">
                                      {slot.expected.pokemonCardId.slice(0, 8)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-pv-muted">missing</span>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            {slot.actual ? (
                              <div className="flex items-center gap-2">
                                {actualCardMeta ? (
                                  <CardImage
                                    src={actualCardMeta.imageUrl}
                                    hiresSrc={actualCardMeta.imageUrlHires}
                                    alt={actualCardMeta.name}
                                    size="sm"
                                    rarityTier={slot.actual.rarityTier}
                                  />
                                ) : null}
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-bold text-pv-text">
                                    {actualCardMeta?.name ?? slot.actual.pokemonCardId.slice(0, 8)}
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px] text-pv-muted">
                                    <RarityBadge rarity={slot.actual.rarityTier} compact />
                                    <span className="font-mono">
                                      {slot.actual.pokemonCardId.slice(0, 8)}
                                    </span>
                                    {actualCardMeta ? (
                                      <span className="font-semibold text-pv-text">
                                        · {formatMoneyCents(actualCardMeta.currentPrice)}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-pv-muted">missing</span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-center">
                            {slot.pass ? (
                              <span className="font-bold text-pv-good">✓</span>
                            ) : (
                              <span className="font-bold text-pv-accent">✕</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap justify-end">
            <Link
              href={routes.fairness.verifyIndex}
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              Back to verify
            </Link>
          </div>
        </>
      ) : null}
    </section>
  );
}
