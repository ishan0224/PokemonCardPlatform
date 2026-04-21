type LoadingCardGridProps = {
  cards?: number;
  minItemWidth?: number;
  itemHeightClassName?: string;
};

export function LoadingCardGrid({
  cards = 6,
  minItemWidth = 260,
  itemHeightClassName = "h-72"
}: LoadingCardGridProps): JSX.Element {
  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`
      }}
      aria-hidden="true"
    >
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className={`${itemHeightClassName} animate-pulse rounded-2xl border border-pv-border bg-pv-parchment-soft`} />
      ))}
    </div>
  );
}
