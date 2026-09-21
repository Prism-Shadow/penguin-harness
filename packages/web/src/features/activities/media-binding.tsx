/**
 * What binds one manifest asset to a file. It replaces the workbench's bare path
 * box: the path is still typed, but it is validated against the server's own rule
 * while typing, it can be cleared, it can be pointed at a file another asset
 * already uses, and it says plainly when the binding belongs to a generation run
 * and is therefore not the author's to edit.
 */
import { useState } from "react";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { mediaPathProblem, reuseCandidates, sharedScenes } from "./scene-assets";

type MediaAsset = AssetManifest["assets"][string][number];

export function MediaBinding({
  asset,
  siblings,
  editable,
  disabled,
  onChange,
}: {
  asset: MediaAsset;
  /** Every asset in the same language group, the pool a reuse is drawn from. */
  siblings: readonly MediaAsset[];
  editable: boolean;
  disabled: boolean;
  onChange: (path: string | undefined) => void;
}) {
  const [reuse, setReuse] = useState("");
  const generated = !!asset.generatedAudio || !!asset.generatedImage;
  const locked = !editable || disabled || generated;
  const problem = asset.path ? mediaPathProblem(asset.path) : null;
  const scenes = sharedScenes(asset);
  const candidates = reuseCandidates(siblings, asset);
  const chosen = candidates.find((candidate) => candidate.key === reuse);
  return (
    <div className="space-y-2">
      {scenes.length > 1 && (
        <p className={`break-words text-xs ${toneInk.attention}`}>
          {S.activities.sharedAssetScenes(scenes.join(", "))}
        </p>
      )}
      <Input
        size="sm"
        label={S.activities.assetPath}
        hint={S.activities.assetPathHint}
        value={asset.path ?? ""}
        disabled={locked}
        error={problem ? S.activities.mediaPathProblems[problem] : undefined}
        // Trimmed on the way in: a surrounding space is never part of a media path,
        // and storing it would pass the inline check and fail the save.
        onChange={(event) => onChange(event.target.value.trim() || undefined)}
      />
      {generated ? (
        <p className="text-xs text-gray-500">{S.activities.generatedBinding}</p>
      ) : (
        editable && (
          <>
            {asset.path && (
              <Button size="sm" disabled={disabled} onClick={() => onChange(undefined)}>
                {S.activities.clearBinding}
              </Button>
            )}
            {candidates.length > 0 && (
              <div className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
                <p className="text-xs font-medium">{S.activities.reuseTitle}</p>
                <p className="text-xs text-gray-500">{S.activities.reuseHint}</p>
                <Select
                  size="sm"
                  label={S.activities.reuseChoose}
                  value={reuse}
                  disabled={disabled}
                  onChange={(event) => setReuse(event.target.value)}
                >
                  <option value="">{S.activities.reuseChoose}</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.key} — {candidate.path}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  disabled={disabled || !chosen}
                  onClick={() => {
                    if (chosen?.path) onChange(chosen.path);
                    setReuse("");
                  }}
                >
                  {S.activities.reuseApply}
                </Button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
