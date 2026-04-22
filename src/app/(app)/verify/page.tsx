import Link from "next/link";
import { Suspense } from "react";
import { VerifyPacksBrowser } from "@/components/fairness/verify-packs-browser";
import { buttonClassName } from "@/components/ui/button-styles";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";

function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function VerifyFallback(): JSX.Element {
  return (
    <section className="space-y-3">
      <p className="text-sm font-medium text-pv-muted">Loading verification entrypoint…</p>
      <LoadingCardGrid cards={3} minItemWidth={280} itemHeightClassName="h-64" />
    </section>
  );
}

export default async function VerifyPage(): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h1">Verify packs</h1>
        <p className="mt-2 text-[13px] text-pv-muted">
          Sign in to browse your packs and run the in-app verifier.
        </p>
        <Link
          href={routes.auth.login}
          className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-4`}
        >
          Go to login
        </Link>
      </section>
    );
  }

  return (
    <Suspense fallback={<VerifyFallback />}>
      <VerifyPacksBrowser defaultDate={todayInputValue()} />
    </Suspense>
  );
}
