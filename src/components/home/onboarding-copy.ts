export type OnboardingStep = {
  id: string;
  title: string;
  body: string;
};

export function buildOnboardingSteps(balanceText: string): OnboardingStep[] {
  return [
    {
      id: "drops",
      title: "How Drops Work",
      body: "Join upcoming drops, pick a tier, and purchase packs while inventory is live."
    },
    {
      id: "balance",
      title: "Your Starting Balance",
      body: `You begin with ${balanceText} available. Use it for pack purchases, listings, and auction bids.`
    },
    {
      id: "fairness",
      title: "Provable Fairness",
      body: "Every pack reveal can be verified in-app. Keep opening, then validate outcomes in Verify."
    }
  ];
}
