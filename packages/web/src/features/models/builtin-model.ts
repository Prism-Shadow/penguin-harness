/** What a built-in agent's card offers in each state (Models → Built-in). */
import type { BuiltinAgentInfo } from "@prismshadow/penguin-server/api";

export function builtinActions(info: BuiltinAgentInfo) {
  const installed = info.installedVersion !== null;
  const none = {
    setup: false,
    cancel: false,
    test: false,
    replaceToken: false,
    update: false,
    remove: false,
    retry: false,
    needsToken: false,
  };
  switch (info.status) {
    case "unsupported":
      return none;
    case "downloading":
      return { ...none, cancel: true };
    case "not-installed":
      return { ...none, setup: true, needsToken: true };
    case "failed":
      return {
        ...none,
        retry: true,
        needsToken: info.tokenMasked === null,
        test: installed,
        replaceToken: installed,
        // A stored token means a definition exists (even one whose program went missing):
        // it must stay removable.
        remove: installed || info.tokenMasked !== null,
      };
    case "update-available":
      return { ...none, update: true, test: true, replaceToken: true, remove: true };
    case "ready":
      return { ...none, test: true, replaceToken: true, remove: true };
  }
}

export function progressPercent(info: BuiltinAgentInfo): number | null {
  const p = info.progress;
  if (p === null || p.total === null || p.total === 0) return null;
  return Math.min(100, Math.round((p.received / p.total) * 100));
}

/**
 * What the card's status line says. Kept out of the component because the "not installed"
 * case splits two ways that must not collide: `unsupported` has nothing useful to invite (the
 * danger strip already carries `info.message`, and a "Downloads about N MB" note next to it
 * would read as an offer the machine cannot honor), while every other not-yet-installed state
 * (fresh, or failed before any version landed) still wants that download-size hint.
 */
export type BuiltinSubtitle =
  | { kind: "downloading" }
  | { kind: "update-available"; installed: string; pinned: string }
  | { kind: "ready"; version: string }
  | { kind: "download-size" }
  | { kind: "none" };

export function builtinSubtitle(info: BuiltinAgentInfo): BuiltinSubtitle {
  if (info.status === "unsupported") return { kind: "none" };
  if (info.status === "downloading") return { kind: "downloading" };
  if (info.status === "update-available" && info.installedVersion !== null) {
    return {
      kind: "update-available",
      installed: info.installedVersion,
      pinned: info.pinnedVersion,
    };
  }
  if (info.installedVersion !== null) return { kind: "ready", version: info.installedVersion };
  return { kind: "download-size" };
}
