"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FixedSizeGrid as Grid } from "react-window";

type CardGridVirtualizedProps = {
  items: unknown[];
  renderItem: (item: unknown, index: number) => ReactNode;
  itemKey: (item: unknown, index: number) => string;
  minItemWidth: number;
  itemHeight: number;
  gap: number;
  ariaLabel?: string;
};

type GridCellData = {
  items: unknown[];
  columnCount: number;
  itemKey: (item: unknown, index: number) => string;
  renderItem: (item: unknown, index: number) => ReactNode;
};

type GridCellProps = {
  columnIndex: number;
  rowIndex: number;
  style: CSSProperties;
  data: GridCellData;
};

function useElementWidth<T extends HTMLElement>(ref: React.RefObject<T>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setWidth(Math.floor(entry.contentRect.width));
    });

    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}

function GridCell({ columnIndex, rowIndex, style, data }: GridCellProps): JSX.Element | null {
  const index = rowIndex * data.columnCount + columnIndex;
  const item = data.items[index];

  if (!item) {
    return null;
  }

  const adjustedStyle: CSSProperties = {
    ...style,
    left: typeof style.left === "number" ? style.left + 8 : style.left,
    top: typeof style.top === "number" ? style.top + 8 : style.top,
    width: typeof style.width === "number" ? style.width - 8 : style.width,
    height: typeof style.height === "number" ? style.height - 8 : style.height
  };

  return (
    <div style={adjustedStyle} role="listitem" className="h-full" data-card-grid-key={data.itemKey(item, index)}>
      {data.renderItem(item, index)}
    </div>
  );
}

export function CardGridVirtualized({
  items,
  renderItem,
  itemKey,
  minItemWidth,
  itemHeight,
  gap,
  ariaLabel = "Card list"
}: CardGridVirtualizedProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);

  const columnCount = useMemo(() => {
    if (width <= 0) {
      return 1;
    }
    return Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
  }, [width, minItemWidth, gap]);

  const rowCount = useMemo(() => Math.ceil(items.length / columnCount), [items.length, columnCount]);

  const gridHeight = useMemo(() => {
    const visibleRows = Math.min(3, rowCount);
    return Math.max(320, visibleRows * itemHeight + 16);
  }, [itemHeight, rowCount]);

  const columnWidth = useMemo(() => {
    if (width <= 0) {
      return minItemWidth;
    }

    const totalGap = Math.max(0, columnCount - 1) * gap;
    return Math.max(minItemWidth, Math.floor((width - totalGap) / columnCount));
  }, [width, minItemWidth, columnCount, gap]);

  const gridData = useMemo<GridCellData>(
    () => ({
      items,
      columnCount,
      itemKey,
      renderItem
    }),
    [items, columnCount, itemKey, renderItem]
  );

  return (
    <section aria-label={ariaLabel} role="list">
      <div ref={containerRef} className="w-full">
        {width > 0 ? (
          <Grid
            columnCount={columnCount}
            columnWidth={columnWidth + gap}
            height={gridHeight}
            rowCount={rowCount}
            rowHeight={itemHeight + gap}
            width={width}
            itemData={gridData}
            overscanRowCount={2}
          >
            {GridCell}
          </Grid>
        ) : (
          <div className="h-80 animate-pulse rounded-2xl border border-pv-border bg-pv-parchment-soft" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}
