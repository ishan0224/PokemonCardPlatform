import { describe, expect, it } from "vitest";
import { decodeUserPacksCursor, encodeUserPacksCursor } from "../pack.service";

describe("pack inventory cursor", () => {
  it("round-trips an opaque cursor payload", () => {
    const encoded = encodeUserPacksCursor({
      purchasedAt: "2026-04-21T10:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111"
    });

    const decoded = decodeUserPacksCursor(encoded);

    expect(decoded).toEqual({
      purchasedAt: "2026-04-21T10:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111"
    });
  });

  it("returns null for malformed cursor payload", () => {
    expect(decodeUserPacksCursor("not-a-valid-cursor")).toBeNull();
  });
});
