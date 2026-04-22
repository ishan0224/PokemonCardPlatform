"use client";

import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-pv-danger bg-white p-6">
      <h1 className="text-2xl font-black text-pv-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-pv-muted">{error.message || "Unexpected application error."}</p>
      <div className="mt-4">
        <Button variant="danger" onClick={reset}>
          Try again
        </Button>
      </div>
    </section>
  );
}
