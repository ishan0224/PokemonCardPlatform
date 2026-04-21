import { PackRevealView } from "@/components/packs/pack-reveal-view";

export default function PackRevealPage({ params }: { params: { id: string } }): JSX.Element {
  return <PackRevealView packId={params.id} />;
}
