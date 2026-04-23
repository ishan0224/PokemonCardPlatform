import { notFound } from "next/navigation";
import { AuctionRoomView } from "@/components/auctions/auction-room-view";
import { serverApiClient } from "@/lib/api-server";
import { useSession } from "@/server/auth/session";

export default async function AuctionRoomPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const session = await useSession();
  const initialAuction = await serverApiClient.getAuction(params.id, session.user?.id ?? null);

  if (!initialAuction) {
    notFound();
  }

  return <AuctionRoomView auctionId={params.id} initialAuction={initialAuction} />;
}
