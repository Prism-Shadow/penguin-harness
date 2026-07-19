/**
 * Button component: GitHub-style simplicity — small border radius + 1px border + a single brand accent, only color transitions.
 */
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "icon";

const variantClass: Record<Variant, string> = {
  // primary uses the theme accent variable (defaults to neutral gray/white, switching with light/dark; becomes that color once an accent is selected).
  primary:
    "bg-[var(--accent-bg)] text-[var(--accent-fg)] border border-[var(--accent-bg)] " +
    "transition-opacity hover:opacity-90 disabled:opacity-50",
  secondary:
    "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 " +
    "dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800",
  danger:
    "bg-white text-red-600 border border-gray-300 hover:border-red-300 hover:bg-red-50 " +
    "dark:bg-gray-900 dark:text-red-400 dark:border-gray-700 dark:hover:bg-red-950",
  ghost:
    "bg-transparent text-gray-600 border border-transparent hover:bg-gray-100 hover:text-gray-900 " +
    "dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100",
};

const sizeClass: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs rounded-md",
  md: "px-3 py-1.5 text-sm rounded-md",
  /** Square icon button (no text; callers must supply title / aria-label). */
  icon: "p-1.5 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1 font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${variantClass[variant]} ${sizeClass[size]} ${className ?? ""}`}
      {...rest}
    />
  );
}
