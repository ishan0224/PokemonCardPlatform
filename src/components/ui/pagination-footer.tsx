"use client";

import { Button } from "@/components/ui/button";

type PaginationFooterProps = {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  loadedCount: number;
  totalCount?: number;
};

export function PaginationFooter({
  hasMore,
  loading,
  onLoadMore,
  loadedCount,
  totalCount
}: PaginationFooterProps): JSX.Element {
  return (
    <footer className="flex flex-col items-center gap-2 border-t border-pv-border pt-4">
      <p className="text-sm text-pv-muted" aria-live="polite">
        Showing {loadedCount}
        {typeof totalCount === "number" ? ` of ${totalCount}` : ""}
      </p>
      <Button type="button" variant="secondary" onClick={onLoadMore} loading={loading} disabled={!hasMore}>
        {hasMore ? "Load More" : "No More Results"}
      </Button>
    </footer>
  );
}
