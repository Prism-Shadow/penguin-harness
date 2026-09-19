import { en } from "./strings-en";
import type { Strings } from "./strings-types";
export type { Strings } from "./strings-types";

/** Active dictionary, assigned before rendering a locale scope. */
export let S: Strings = en;

export function setActiveStrings(next: Strings): void {
  S = next;
}
