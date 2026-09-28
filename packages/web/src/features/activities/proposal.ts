/**
 * An agent's proposal, as the studio reviews it.
 *
 * The server hands back what the conversation's agent last wrote to `proposal.json`,
 * already checked (see the server's `assist.ts`). The studio shows each change as a diff
 * against the saved draft, not against the copy the agent read, so what the author
 * accepts is exactly what will change, even if the draft moved on since the agent looked.
 */
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

export type ProposalChange =
  | { target: "description"; text: string }
  | { target: "spec"; spec: Record<string, unknown> }
  | {
      target: "media";
      language: string;
      assetKey: string;
      field: "description" | "script";
      text: string;
    };

export interface AssistProposal {
  summary: string;
  changes: ProposalChange[];
}

/** The saved draft, as far as a proposal can touch it. */
export interface ProposalBase {
  description: string;
  spec: Record<string, unknown> | null;
  manifest: AssetManifest | null;
}

const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

/** A change's identity within a proposal, which the server keeps unique. */
export function changeKey(change: ProposalChange): string {
  return change.target === "media" ? `media:${change.language}:${change.assetKey}` : change.target;
}

/** What the author calls the thing a change changes. */
export function changeLabel(change: ProposalChange): string {
  const words = S.activities.studioProposal;
  if (change.target === "description") return words.script;
  if (change.target === "spec") return words.spec;
  return words.media(change.assetKey, change.field, change.language);
}

/**
 * The saved text and the proposed text, for the diff. Null when the change has nothing to
 * apply to: an asset the saved media plan does not have.
 */
export function changeTexts(
  change: ProposalChange,
  base: ProposalBase,
): { before: string; after: string } | null {
  if (change.target === "description") return { before: base.description, after: change.text };
  if (change.target === "spec") return { before: pretty(base.spec), after: pretty(change.spec) };
  const asset = base.manifest?.assets[change.language]?.find(
    (item) => item.key === change.assetKey,
  );
  if (!asset) return null;
  // Only audio has a script; an image's description is its prompt.
  if (change.field === "script" && asset.type !== "audio") return null;
  return {
    before: (change.field === "script" ? asset.script : asset.description) ?? "",
    after: change.text,
  };
}

/** Whether accepting would change nothing, as when it was accepted already. */
export function changeIsApplied(change: ProposalChange, base: ProposalBase): boolean {
  const texts = changeTexts(change, base);
  return !!texts && texts.before === texts.after;
}

/** The media plan with one asset's text replaced, and nothing else touched. */
export function applyMediaChange(
  manifest: AssetManifest,
  change: Extract<ProposalChange, { target: "media" }>,
): AssetManifest {
  const assets = manifest.assets[change.language];
  if (!assets?.some((asset) => asset.key === change.assetKey))
    throw new Error(S.activities.studioProposal.missingAsset(change.assetKey));
  return {
    ...manifest,
    assets: {
      ...manifest.assets,
      [change.language]: assets.map((asset) =>
        asset.key === change.assetKey ? { ...asset, [change.field]: change.text } : asset,
      ),
    },
  };
}
