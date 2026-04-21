"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

type CardGridProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemKey?: (item: T, index: number) => string;
  minItemWidth?: number;
  virtualizedItemHeight?: number;
  virtualizedThreshold?: number;
  gap?: number;
  ariaLabel?: string;
};

type CardGridVirtualizedProps = {
  items: unknown[];
  renderItem: (item: unknown, index: number) => ReactNode;
  itemKey: (item: unknown, index: number) => string;
  minItemWidth: number;
  itemHeight: number;
  gap: number;
  ariaLabel?: string;
};

const CardGridVirtualized = dynamic<CardGridVirtualizedProps>(
  () => import("@/components/ui/card-grid-virtualized").then((module) => module.CardGridVirtualized as never),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="h-80 animate-pulse rounded-2xl border border-pv-border bg-pv-parchment-soft" />
        ))}
      </div>
    )
  }
);

function defaultItemKey<T>(_item: T, index: number): string {
  return `card-grid-${index}`;
}

export function CardGrid<T>({
  items,
  renderItem,
  itemKey = defaultItemKey,
  minItemWidth = 220,
  virtualizedItemHeight = 430,
  virtualizedThreshold = 50,
  gap = 16,
  ariaLabel = "Card list"
}: CardGridProps<T>): JSX.Element {
  if (items.length < virtualizedThreshold) {
    return (
      <ul
        role="list"
        aria-label={ariaLabel}
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`
        }}
      >
        {items.map((item, index) => (
          <li key={itemKey(item, index)} className="h-full">
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <CardGridVirtualized
      items={items as unknown[]}
      renderItem={renderItem as (item: unknown, index: number) => ReactNode}
      itemKey={itemKey as (item: unknown, index: number) => string}
      minItemWidth={minItemWidth}
      itemHeight={virtualizedItemHeight}
      gap={gap}
      ariaLabel={ariaLabel}
    />
  );
}
