export type FairnessVerificationStatus =
  | "VERIFIABLE"
  | "SEED_UNREVEALED"
  | "SEED_DECRYPTION_FAILED"
  | "UNVERIFIABLE_LEGACY_PACK";

export function getVerificationStatusLabel(status: FairnessVerificationStatus): string {
  switch (status) {
    case "VERIFIABLE":
      return "Verifiable";
    case "SEED_UNREVEALED":
      return "Seed Unrevealed";
    case "SEED_DECRYPTION_FAILED":
      return "Seed Decryption Failed";
    case "UNVERIFIABLE_LEGACY_PACK":
      return "Legacy Pack";
    default:
      return "Unknown";
  }
}

export function isVerificationGreen(input: { status: FairnessVerificationStatus; overallPass: boolean }): boolean {
  return input.status === "VERIFIABLE" && input.overallPass;
}

export function shouldShowLegacyBanner(status: FairnessVerificationStatus): boolean {
  return status === "UNVERIFIABLE_LEGACY_PACK";
}

export function shouldShowUnrevealedBanner(status: FairnessVerificationStatus): boolean {
  return status === "SEED_UNREVEALED";
}
