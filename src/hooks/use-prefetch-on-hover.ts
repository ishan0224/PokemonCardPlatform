"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

export function usePrefetchOnHover(href: string): { onMouseEnter: () => void } {
  const router = useRouter();
  const onMouseEnter = useCallback(() => {
    router.prefetch(href);
  }, [router, href]);
  return { onMouseEnter };
}
