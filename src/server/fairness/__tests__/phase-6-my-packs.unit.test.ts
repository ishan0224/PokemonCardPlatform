import { describe, expect, it } from "vitest";
import {
  decodeFairnessMyPacksCursor,
  encodeFairnessMyPacksCursor,
  FairnessQueryServiceError
} from "../../services/fairness-query.service";

describe("Phase 6 fairness my-packs cursor", () => {
  it("round-trips opaque cursor payload", () => {
    const encoded = encodeFairnessMyPacksCursor({
      purchasedAt: "2026-04-21T10:00:00.000Z",
      packId: "11111111-1111-4111-8111-111111111111"
    });

    const decoded = decodeFairnessMyPacksCursor(encoded);

    expect(decoded).toEqual({
      purchasedAt: "2026-04-21T10:00:00.000Z",
      packId: "11111111-1111-4111-8111-111111111111"
    });
  });

  it("rejects malformed cursor payload", () => {
    expect(() => decodeFairnessMyPacksCursor("not-a-valid-cursor")).toThrowError(FairnessQueryServiceError);

    try {
      decodeFairnessMyPacksCursor("not-a-valid-cursor");
    } catch (error) {
      const typed = error as FairnessQueryServiceError;
      expect(typed.code).toBe("INVALID_CURSOR");
    }
  });
});
