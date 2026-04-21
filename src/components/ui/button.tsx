"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant
} from "@/components/ui/button-styles";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};
export { buttonClassName };

function LoadingSpinner(): JSX.Element {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />;
}

export function Button({
  type = "button",
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  fullWidth = false,
  leftIcon,
  rightIcon,
  className,
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonClassName({
        variant,
        size,
        fullWidth,
        className
      })}
      {...props}
    >
      {loading ? <LoadingSpinner /> : leftIcon}
      <span>{children}</span>
      {!loading ? rightIcon : null}
    </button>
  );
}
