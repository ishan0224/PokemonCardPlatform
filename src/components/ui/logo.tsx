type LogoProps = {
  height?: number;
  priority?: boolean;
  className?: string;
};

const SOURCE_WIDTH = 2400;
const SOURCE_HEIGHT = 1309;
const ASPECT_RATIO = SOURCE_WIDTH / SOURCE_HEIGHT;

export function Logo({
  height = 40,
  priority = false,
  className
}: LogoProps): JSX.Element {
  const width = Math.round(height * ASPECT_RATIO);
  const loading = priority ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : "auto";

  return (
    <picture>
      <source srcSet="/images/Logo.avif" type="image/avif" />
      <source srcSet="/images/Logo.webp" type="image/webp" />
      <img
        src="/images/Logo.png"
        alt="PullVault"
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        className={className}
      />
    </picture>
  );
}
