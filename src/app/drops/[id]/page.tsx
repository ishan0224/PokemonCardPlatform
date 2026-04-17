import { DropDetailView } from "@/components/drops/drop-detail-view";

export default function DropDetailPage({ params }: { params: { id: string } }): JSX.Element {
  return <DropDetailView dropId={params.id} />;
}
