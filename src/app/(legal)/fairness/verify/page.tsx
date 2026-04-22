import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClassName } from "@/components/ui/button-styles";
import { LegalShell } from "@/components/ui/legal-shell";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VerifyIndexPageProps = {
  searchParams?: {
    packId?: string;
  };
};

function normalizePackId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!UUID_RE.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

export default async function PublicVerifyIndexPage({ searchParams }: VerifyIndexPageProps): Promise<JSX.Element> {
  const session = await useSession();
  if (session.isAuthenticated && session.user) {
    redirect(routes.fairness.verifyIndex);
  }

  const rawPackId = typeof searchParams?.packId === "string" ? searchParams.packId : "";
  const normalizedPackId = rawPackId.length > 0 ? normalizePackId(rawPackId) : null;

  if (normalizedPackId) {
    redirect(routes.fairness.publicVerify(normalizedPackId));
  }

  const showInvalidInput = rawPackId.length > 0 && !normalizedPackId;

  return (
    <LegalShell title="Verify a Pack" updatedOn="April 22, 2026">
      <p>
        Enter a pack ID to run the public fairness verifier. Anyone can verify a past opening once the drop seed is
        revealed.
      </p>
      <form method="GET" action={routes.fairness.publicVerifyIndex} className="mt-5 space-y-3">
        <label htmlFor="pack-id" className="block text-[12px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
          Pack ID (UUID)
        </label>
        <input
          id="pack-id"
          name="packId"
          type="text"
          defaultValue={rawPackId}
          autoComplete="off"
          placeholder="00000000-0000-0000-0000-000000000000"
          className="block min-h-11 w-full rounded-pv-sm border border-pv-line bg-pv-surface-2 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
        />
        {showInvalidInput ? (
          <p role="alert" className="text-[12px] font-medium text-pv-accent">
            Enter a valid UUID pack ID.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            Open Verifier
          </button>
          <Link href={routes.legal.fairnessAudit} className={buttonClassName({ variant: "ghost", size: "sm" })}>
            View Aggregate Audit
          </Link>
        </div>
      </form>
    </LegalShell>
  );
}
