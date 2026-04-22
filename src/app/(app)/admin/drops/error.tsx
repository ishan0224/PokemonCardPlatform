"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

type AdminDropsErrorProps = {
  error: Error;
  reset: () => void;
};

export default function AdminDropsError({ error, reset }: AdminDropsErrorProps): JSX.Element {
  useEffect(() => {
    console.error("Admin drops route error:", error);
  }, [error]);

  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
      <h1 className="text-xl font-black">Admin drops failed to load</h1>
      <p className="mt-2 text-sm">Try again. If this persists, check server logs for details.</p>
      <div className="mt-4">
        <Button variant="secondary" onClick={reset}>
          Retry
        </Button>
      </div>
    </section>
  );
}
