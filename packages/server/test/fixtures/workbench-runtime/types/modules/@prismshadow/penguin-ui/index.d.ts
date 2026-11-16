import type { ReactElement, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary";

export interface ButtonProps {
  variant?: ButtonVariant;
  onClick?: () => void;
  children?: ReactNode;
}

export declare function Button(props: ButtonProps): ReactElement;
