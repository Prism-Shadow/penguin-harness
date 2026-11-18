import { createContext } from "react";

/** A paged activity remembers each row's disclosure when another page takes its place. */
export const StepDisclosure = createContext<{
  open: boolean;
  bounded: boolean;
  follow: boolean;
  toggle: () => void;
} | null>(null);
