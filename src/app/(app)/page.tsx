import { AuthedHome } from "@/components/home/authed-home";
import { OnboardingOverlay } from "@/components/home/onboarding-overlay";
import { GuestHome } from "@/components/home/guest-home";
import { useSession } from "@/server/auth/session";

export default async function HomePage(): Promise<JSX.Element> {
  const session = await useSession();

  if (session.isAuthenticated && session.user) {
    return (
      <>
        <AuthedHome user={session.user} />
        <OnboardingOverlay userId={session.user.id} />
      </>
    );
  }

  return <GuestHome />;
}
