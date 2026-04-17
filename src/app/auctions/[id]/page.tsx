import { AuctionRoomView } from "@/components/auctions/auction-room-view";

export default function AuctionRoomPage({ params }: { params: { id: string } }): JSX.Element {
  return <AuctionRoomView auctionId={params.id} />;
}
