import Image from "next/image";

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

  return (
    <Image
      src="/images/Logo.png"
      alt="PullVault"
      width={width}
      height={height}
      priority={priority}
      className={className}
      sizes={`${width}px`}
    />
  );
}
