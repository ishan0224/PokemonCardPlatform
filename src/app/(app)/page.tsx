import { AuthedHome } from "@/components/home/authed-home";
import { GuestHome } from "@/components/home/guest-home";
import { useSession } from "@/server/auth/session";

export default async function HomePage(): Promise<JSX.Element> {
  try {
    const session = await useSession();

    if (session.isAuthenticated && session.user) {
      return <AuthedHome user={session.user} />;
    }

    return <GuestHome />;
  } catch (_error) {
    return <GuestHome />;
  }
}
