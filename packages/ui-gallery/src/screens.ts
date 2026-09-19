/**
 * The full-viewport composites for `/screens/<name>` and the Screens module, by id, in the order
 * `packages/ui/src/screens/index.ts` lists them.
 */
import { SCREENS as SCREEN_LIST } from "../../ui/src/screens";
import type { ScreenEntry } from "../../ui/src/screens";

export type { ScreenEntry };

export const SCREENS: Readonly<Record<string, ScreenEntry>> = Object.fromEntries(
  SCREEN_LIST.map((entry) => [entry.id, entry]),
);
