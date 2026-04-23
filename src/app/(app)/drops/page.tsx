import { DropsPageClient } from "@/components/drops/drops-page-client";
import { serverApiClient } from "@/lib/api-server";

export default async function DropsPage(): Promise<JSX.Element> {
  const [upcomingResult, liveResult] = await Promise.all([
    serverApiClient.listDropsByStatus(["upcoming"], 6),
    serverApiClient.listDropsByStatus(["active"], 12)
  ]);

  return (
    <DropsPageClient
      initialUpcoming={upcomingResult.drops}
      initialLive={liveResult.drops}
    />
  );
}
