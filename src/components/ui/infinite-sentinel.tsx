"use client";

import { useEffect, useRef } from "react";

type InfiniteSentinelProps = {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
};

export function InfiniteSentinel({ hasMore, loading, onLoadMore }: InfiniteSentinelProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || loading) {
          return;
        }

        onLoadMore();
      },
      {
        rootMargin: "200px 0px"
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, onLoadMore]);

  return (
    <div ref={ref} role="status" aria-live="polite" className="py-3 text-center text-sm text-pv-muted">
      {loading ? "Loading more" : hasMore ? "Scroll to load more" : "End of list"}
    </div>
  );
}
