import type { ToolModelKey, ToolModelSettings } from "@prismshadow/penguin-server/api";
import { sameModelRef } from "./model-grouping";

/** A saved selection is runnable only while its server contribution and configured model exist. */
export function hasBoundCapability(
  settings: ToolModelSettings | null | undefined,
  key: ToolModelKey,
): boolean {
  const binding = settings?.bindings[key];
  return Boolean(
    binding &&
    settings?.available?.some((entry) => entry.key === key) &&
    settings.candidates[key]?.some((row) => sameModelRef(row, binding)),
  );
}
