import { jsx } from "react/jsx-runtime";

export function Button({ variant = "secondary", ...props }) {
  return jsx("button", { ...props, "data-variant": variant });
}
