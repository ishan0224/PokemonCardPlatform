import { redirect } from "next/navigation";
import { VerifyPackPanel } from "@/components/fairness/verify-pack-panel";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";

export default async function PublicVerifyPackPage({
  params
}: {
  params: { packId: string };
}): Promise<JSX.Element> {
  const session = await useSession();
  if (session.isAuthenticated && session.user) {
    redirect(routes.fairness.verify(params.packId));
  }

  return <VerifyPackPanel packId={params.packId} verifyIndexHref={routes.fairness.publicVerifyIndex} />;
}
