import {
  FAIRNESS_DUPLICATE_REROLL_MAX_ATTEMPTS,
  FAIRNESS_REJECTION_MAX_ATTEMPTS,
  FAIRNESS_UNIQUE_FIRST_ATTEMPTS
} from "./constants";
import type { PackTier, RarityTier } from "../types";

const UINT256_MODULUS = 1n << 256n;
const UINT64_MAX = (1n << 64n) - 1n;
const WEIGHT_SCALE = 1_000_000_000;

export type HmacSha256Fn = (key: Uint8Array, message: Uint8Array) => Promise<Uint8Array>;

export type CanonicalSlotBuckets = readonly RarityTier[];

export type CanonicalGeneratedCard = {
  slotNumber: number;
  rarityTier: RarityTier;
  pokemonCardId: string;
};

export type CanonicalDrawType = "rarity" | "card_index" | "duplicate_reroll";

export type CanonicalDrawTranscriptEntry = {
  drawCounterBefore: string;
  drawType: CanonicalDrawType;
  slotNumber: number;
  modulus: number;
  accepted: boolean;
  selectedIndex: number | null;
};

export type CanonicalPackGenerationInput = {
  tier: PackTier;
  serverSeedHex: string;
  clientSeedHex: string;
  nonce: bigint;
  slots: readonly CanonicalSlotBuckets[];
  eligibleCardIdsByRarity: Record<RarityTier, readonly string[]>;
  enforceUniqueCards?: boolean;
};

export type CanonicalPackGenerationOutput = {
  cards: CanonicalGeneratedCard[];
  drawCounterConsumed: bigint;
  drawTranscript: CanonicalDrawTranscriptEntry[];
};

export type WeightedSlotDistribution = {
  rarity: RarityTier;
  weight: number;
};

export type WeightedPackGenerationInput = {
  tier: PackTier;
  serverSeedHex: string;
  clientSeedHex: string;
  nonce: bigint;
  slots: readonly (readonly WeightedSlotDistribution[])[];
  eligibleCardIdsByRarity: Record<RarityTier, readonly string[]>;
  enforceUniqueCards?: boolean;
  uniqueFirstAttempts?: number;
  allowDuplicateFallback?: boolean;
};

export type CanonicalTestVectorFixture = {
  id: string;
  tier: PackTier;
  inputs: {
    serverSeedHex: string;
    clientSeedHex: string;
    nonce: string;
    slots: RarityTier[][];
    eligibleCardIdsByRarity: Record<RarityTier, string[]>;
    enforceUniqueCards: boolean;
  };
  expected: {
    cards: CanonicalGeneratedCard[];
    drawCounterConsumed: string;
    drawTranscript: CanonicalDrawTranscriptEntry[];
  };
};

export class FairnessDrawError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function hexNibble(charCode: number): number {
  if (charCode >= 48 && charCode <= 57) {
    return charCode - 48;
  }
  if (charCode >= 65 && charCode <= 70) {
    return charCode - 55;
  }
  if (charCode >= 97 && charCode <= 102) {
    return charCode - 87;
  }
  return -1;
}

function hexToBytes(hex: string, expectedBytes: number, field: string): Uint8Array {
  const expectedHexLength = expectedBytes * 2;
  if (hex.length !== expectedHexLength) {
    throw new FairnessDrawError("INVALID_HEX_LENGTH", `${field} must be ${expectedHexLength} hex chars.`, {
      field,
      expectedLength: expectedHexLength,
      actualLength: hex.length
    });
  }

  const output = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    const hi = hexNibble(hex.charCodeAt(index * 2));
    const lo = hexNibble(hex.charCodeAt(index * 2 + 1));
    if (hi < 0 || lo < 0) {
      throw new FairnessDrawError("INVALID_HEX", `${field} must be valid hex.`, { field });
    }
    output[index] = (hi << 4) | lo;
  }

  return output;
}

function asU64LE(value: bigint, field: string): Uint8Array {
  if (value < 0n || value > UINT64_MAX) {
    throw new FairnessDrawError("INVALID_U64", `${field} must be uint64.`, {
      field,
      value: value.toString()
    });
  }

  const output = new Uint8Array(8);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setBigUint64(0, value, true);
  return output;
}

function uint256FromBigEndianBytes(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) {
    throw new FairnessDrawError("INVALID_DIGEST_LENGTH", "HMAC-SHA256 output must be 32 bytes.", {
      actualLength: bytes.length
    });
  }

  let output = 0n;
  for (const byte of bytes) {
    output = (output << 8n) + BigInt(byte);
  }
  return output;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;

  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }

  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.length);
  new Uint8Array(output).set(bytes);
  return output;
}

async function defaultHmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new FairnessDrawError("WEB_CRYPTO_UNAVAILABLE", "Web Crypto subtle API is not available.");
  }

  const cryptoKey = await subtle.importKey("raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await subtle.sign("HMAC", cryptoKey, toArrayBuffer(message));
  return new Uint8Array(signature);
}

function assertPoolSortedAsc(pool: readonly string[], rarity: RarityTier): void {
  for (let index = 1; index < pool.length; index += 1) {
    if (pool[index - 1].localeCompare(pool[index]) > 0) {
      throw new FairnessDrawError(
        "POOL_NOT_SORTED",
        "Eligible card IDs must be sorted by id ASC before deterministic generation.",
        { rarity }
      );
    }
  }
}

export function canonicalizeEligibleCardIdsByRarity(input: Record<RarityTier, readonly string[]>): Record<RarityTier, readonly string[]> {
  return {
    common: [...input.common].sort((a, b) => a.localeCompare(b)),
    uncommon: [...input.uncommon].sort((a, b) => a.localeCompare(b)),
    rare: [...input.rare].sort((a, b) => a.localeCompare(b)),
    holo_rare: [...input.holo_rare].sort((a, b) => a.localeCompare(b)),
    ultra_rare: [...input.ultra_rare].sort((a, b) => a.localeCompare(b)),
    chase: [...input.chase].sort((a, b) => a.localeCompare(b))
  };
}

async function sampleIndexWithRejection(input: {
  serverSeedBytes: Uint8Array;
  clientSeedBytes: Uint8Array;
  nonce: bigint;
  modulus: number;
  drawState: { drawCounter: bigint };
  hmacSha256: HmacSha256Fn;
  drawType: CanonicalDrawType;
  slotNumber: number;
  transcript: CanonicalDrawTranscriptEntry[];
}): Promise<number> {
  if (!Number.isInteger(input.modulus) || input.modulus <= 0) {
    throw new FairnessDrawError("INVALID_MODULUS", "Sampling modulus must be positive.", {
      modulus: input.modulus,
      drawType: input.drawType,
      slotNumber: input.slotNumber
    });
  }

  const modulusBigInt = BigInt(input.modulus);
  const maxAccept = (UINT256_MODULUS / modulusBigInt) * modulusBigInt;

  for (let attempt = 0; attempt < FAIRNESS_REJECTION_MAX_ATTEMPTS; attempt += 1) {
    const drawCounterBefore = input.drawState.drawCounter;
    const message = concatBytes([input.clientSeedBytes, asU64LE(input.nonce, "nonce"), asU64LE(drawCounterBefore, "drawCounter")]);
    const digest = await input.hmacSha256(input.serverSeedBytes, message);
    input.drawState.drawCounter += 1n;

    const value = uint256FromBigEndianBytes(digest);
    const accepted = value < maxAccept;
    const selectedIndex = accepted ? Number(value % modulusBigInt) : null;

    input.transcript.push({
      drawCounterBefore: drawCounterBefore.toString(),
      drawType: input.drawType,
      slotNumber: input.slotNumber,
      modulus: input.modulus,
      accepted,
      selectedIndex
    });

    if (accepted && selectedIndex !== null) {
      return selectedIndex;
    }
  }

  throw new FairnessDrawError("RNG_EXHAUSTED", "Rejection sampling exhausted attempt budget.", {
    drawType: input.drawType,
    slotNumber: input.slotNumber,
    modulus: input.modulus
  });
}

export async function generateCanonicalPack(
  input: CanonicalPackGenerationInput,
  options?: { hmacSha256?: HmacSha256Fn }
): Promise<CanonicalPackGenerationOutput> {
  const hmacSha256 = options?.hmacSha256 ?? defaultHmacSha256;
  const serverSeedBytes = hexToBytes(input.serverSeedHex, 32, "serverSeedHex");
  const clientSeedBytes = hexToBytes(input.clientSeedHex, 16, "clientSeedHex");
  const drawState = { drawCounter: 0n };
  const drawTranscript: CanonicalDrawTranscriptEntry[] = [];
  const cards: CanonicalGeneratedCard[] = [];
  const usedCardIds = new Set<string>();
  const enforceUniqueCards = input.enforceUniqueCards ?? false;

  for (let slotIndex = 0; slotIndex < input.slots.length; slotIndex += 1) {
    const slot = input.slots[slotIndex];
    const slotNumber = slotIndex + 1;

    if (slot.length === 0) {
      throw new FairnessDrawError("SLOT_TOPOLOGY_MISMATCH", "Slot rarity bucket list must be non-empty.", {
        slotNumber
      });
    }

    const rarityIndex = await sampleIndexWithRejection({
      serverSeedBytes,
      clientSeedBytes,
      nonce: input.nonce,
      modulus: slot.length,
      drawState,
      hmacSha256,
      drawType: "rarity",
      slotNumber,
      transcript: drawTranscript
    });

    const rarity = slot[rarityIndex];
    const pool = input.eligibleCardIdsByRarity[rarity];

    if (!pool || pool.length === 0) {
      throw new FairnessDrawError("CATALOG_INSUFFICIENT", "Eligible card pool is empty for sampled rarity.", {
        slotNumber,
        rarity
      });
    }

    assertPoolSortedAsc(pool, rarity);

    let selectedCardId = pool[
      await sampleIndexWithRejection({
        serverSeedBytes,
        clientSeedBytes,
        nonce: input.nonce,
        modulus: pool.length,
        drawState,
        hmacSha256,
        drawType: "card_index",
        slotNumber,
        transcript: drawTranscript
      })
    ];

    if (enforceUniqueCards && usedCardIds.has(selectedCardId)) {
      let resolved = false;
      for (let rerollAttempt = 0; rerollAttempt < FAIRNESS_DUPLICATE_REROLL_MAX_ATTEMPTS; rerollAttempt += 1) {
        const rerolledCardId = pool[
          await sampleIndexWithRejection({
            serverSeedBytes,
            clientSeedBytes,
            nonce: input.nonce,
            modulus: pool.length,
            drawState,
            hmacSha256,
            drawType: "duplicate_reroll",
            slotNumber,
            transcript: drawTranscript
          })
        ];

        if (!usedCardIds.has(rerolledCardId)) {
          selectedCardId = rerolledCardId;
          resolved = true;
          break;
        }
      }

      if (!resolved) {
        throw new FairnessDrawError("RNG_EXHAUSTED", "Duplicate re-roll path exhausted attempt budget.", {
          slotNumber,
          rarity
        });
      }
    }

    usedCardIds.add(selectedCardId);
    cards.push({
      slotNumber,
      rarityTier: rarity,
      pokemonCardId: selectedCardId
    });
  }

  return {
    cards,
    drawCounterConsumed: drawState.drawCounter,
    drawTranscript
  };
}

function validateWeightedSlot(slot: readonly WeightedSlotDistribution[], tier: PackTier, slotNumber: number): void {
  if (!Array.isArray(slot) || slot.length === 0) {
    throw new FairnessDrawError("SLOT_TOPOLOGY_MISMATCH", "Weighted slot must be a non-empty array.", {
      tier,
      slotNumber
    });
  }

  const totalWeight = slot.reduce((sum, entry) => sum + entry.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.0001) {
    throw new FairnessDrawError("SLOT_TOPOLOGY_MISMATCH", "Weighted slot probabilities must sum to 1.", {
      tier,
      slotNumber,
      totalWeight
    });
  }

  if (slot.some((entry) => entry.weight <= 0)) {
    throw new FairnessDrawError("SLOT_TOPOLOGY_MISMATCH", "Weighted slot probabilities must be positive.", {
      tier,
      slotNumber
    });
  }
}

async function sampleWeightedRarity(input: {
  tier: PackTier;
  slotNumber: number;
  slot: readonly WeightedSlotDistribution[];
  serverSeedBytes: Uint8Array;
  clientSeedBytes: Uint8Array;
  nonce: bigint;
  drawState: { drawCounter: bigint };
  hmacSha256: HmacSha256Fn;
  transcript: CanonicalDrawTranscriptEntry[];
}): Promise<RarityTier> {
  validateWeightedSlot(input.slot, input.tier, input.slotNumber);

  const scaledWeights = input.slot.map((entry) => {
    const scaled = Math.round(entry.weight * WEIGHT_SCALE);
    if (!Number.isSafeInteger(scaled) || scaled <= 0) {
      throw new FairnessDrawError(
        "SLOT_TOPOLOGY_MISMATCH",
        "Weighted slot probability is invalid after deterministic scaling.",
        {
          tier: input.tier,
          slotNumber: input.slotNumber,
          rarity: entry.rarity,
          weight: entry.weight
        }
      );
    }
    return scaled;
  });

  const totalScaled = scaledWeights.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalScaled) || totalScaled <= 0) {
    throw new FairnessDrawError("SLOT_TOPOLOGY_MISMATCH", "Weighted slot scale overflow.", {
      tier: input.tier,
      slotNumber: input.slotNumber
    });
  }

  const sampled = await sampleIndexWithRejection({
    serverSeedBytes: input.serverSeedBytes,
    clientSeedBytes: input.clientSeedBytes,
    nonce: input.nonce,
    modulus: totalScaled,
    drawState: input.drawState,
    hmacSha256: input.hmacSha256,
    drawType: "rarity",
    slotNumber: input.slotNumber,
    transcript: input.transcript
  });

  let cumulative = 0;
  for (let index = 0; index < scaledWeights.length; index += 1) {
    cumulative += scaledWeights[index];
    if (sampled < cumulative) {
      return input.slot[index].rarity;
    }
  }

  return input.slot[input.slot.length - 1].rarity;
}

export async function generateWeightedPack(
  input: WeightedPackGenerationInput,
  options?: { hmacSha256?: HmacSha256Fn }
): Promise<CanonicalPackGenerationOutput> {
  const hmacSha256 = options?.hmacSha256 ?? defaultHmacSha256;
  const serverSeedBytes = hexToBytes(input.serverSeedHex, 32, "serverSeedHex");
  const clientSeedBytes = hexToBytes(input.clientSeedHex, 16, "clientSeedHex");
  const drawState = { drawCounter: 0n };
  const drawTranscript: CanonicalDrawTranscriptEntry[] = [];
  const cards: CanonicalGeneratedCard[] = [];
  const usedCardIds = new Set<string>();
  const enforceUniqueCards = input.enforceUniqueCards ?? true;
  const uniqueFirstAttempts = Math.max(1, input.uniqueFirstAttempts ?? FAIRNESS_UNIQUE_FIRST_ATTEMPTS);
  const allowDuplicateFallback = input.allowDuplicateFallback ?? true;

  for (let slotIndex = 0; slotIndex < input.slots.length; slotIndex += 1) {
    const slotNumber = slotIndex + 1;
    const slot = input.slots[slotIndex];
    const rarity = await sampleWeightedRarity({
      tier: input.tier,
      slotNumber,
      slot,
      serverSeedBytes,
      clientSeedBytes,
      nonce: input.nonce,
      drawState,
      hmacSha256,
      transcript: drawTranscript
    });

    const pool = input.eligibleCardIdsByRarity[rarity];
    if (!pool || pool.length === 0) {
      throw new FairnessDrawError("CATALOG_INSUFFICIENT", "Eligible card pool is empty for sampled rarity.", {
        tier: input.tier,
        slotNumber,
        rarity
      });
    }

    assertPoolSortedAsc(pool, rarity);

    let selectedCardId: string | null = null;
    if (enforceUniqueCards) {
      for (let attempt = 0; attempt < uniqueFirstAttempts; attempt += 1) {
        const candidate = pool[
          await sampleIndexWithRejection({
            serverSeedBytes,
            clientSeedBytes,
            nonce: input.nonce,
            modulus: pool.length,
            drawState,
            hmacSha256,
            drawType: attempt === 0 ? "card_index" : "duplicate_reroll",
            slotNumber,
            transcript: drawTranscript
          })
        ];

        if (!usedCardIds.has(candidate)) {
          selectedCardId = candidate;
          break;
        }
      }
    } else {
      selectedCardId = pool[
        await sampleIndexWithRejection({
          serverSeedBytes,
          clientSeedBytes,
          nonce: input.nonce,
          modulus: pool.length,
          drawState,
          hmacSha256,
          drawType: "card_index",
          slotNumber,
          transcript: drawTranscript
        })
      ];
    }

    if (!selectedCardId) {
      if (!allowDuplicateFallback) {
        throw new FairnessDrawError(
          "RNG_EXHAUSTED",
          "Unique card sampling exhausted deterministic attempt budget.",
          { tier: input.tier, slotNumber, rarity }
        );
      }

      selectedCardId = pool[
        await sampleIndexWithRejection({
          serverSeedBytes,
          clientSeedBytes,
          nonce: input.nonce,
          modulus: pool.length,
          drawState,
          hmacSha256,
          drawType: "card_index",
          slotNumber,
          transcript: drawTranscript
        })
      ];
    }

    usedCardIds.add(selectedCardId);
    cards.push({
      slotNumber,
      rarityTier: rarity,
      pokemonCardId: selectedCardId
    });
  }

  return {
    cards,
    drawCounterConsumed: drawState.drawCounter,
    drawTranscript
  };
}
