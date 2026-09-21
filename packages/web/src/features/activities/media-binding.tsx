/**
 * What binds one manifest asset to a file. It replaces the workbench's bare path
 * box: the path is still typed, but it is validated against the server's own rule
 * while typing, it can be cleared, it can be pointed at a file another asset
 * already uses, and it says plainly when the binding belongs to a generation run
 * and is therefore not the author's to edit.
 */
import { useState } from "react";
import type { AssetManifest, UploadedMedia } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { labelButtonClass } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { UPLOAD_ACCEPT, isUploadPath, uploadKindFor } from "./media-library";
import { MediaLibraryModal } from "./media-library-modal";
import { mediaPathProblem, reuseCandidates, sharedScenes } from "./scene-assets";

type MediaAsset = AssetManifest["assets"][string][number];

export function MediaBinding({
  asset,
  siblings,
  media,
  mediaLoading,
  endpoint,
  editable,
  disabled,
  onChange,
  onUpload,
}: {
  asset: MediaAsset;
  /** Every asset in the same language group, the pool a reuse is drawn from. */
  siblings: readonly MediaAsset[];
  /** Everything uploaded for this activity, the pool the library offers. */
  media: readonly UploadedMedia[];
  mediaLoading: boolean;
  endpoint: string;
  editable: boolean;
  disabled: boolean;
  onChange: (path: string | undefined) => void;
  /** Uploads the file and resolves with what the server stored, or rejects. */
  onUpload: (file: File) => Promise<UploadedMedia>;
}) {
  const [reuse, setReuse] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const kind = uploadKindFor(asset.type);
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
      {asset.path && !generated && (
        <p className="text-xs text-gray-500">
          {isUploadPath(asset.path) ? S.activities.uploadedBinding : S.activities.checkoutBinding}
        </p>
      )}
      {generated ? (
        <p className="text-xs text-gray-500">{S.activities.generatedBinding}</p>
      ) : (
        editable && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
                <p className="text-xs font-medium">{S.activities.uploadTitle}</p>
                <p className="text-xs text-gray-500">{S.activities.uploadHint[kind]}</p>
                <label
                  className={`relative inline-flex items-center ${labelButtonClass("secondary", "sm")}`}
                >
                  <HiddenFileInput
                    accept={UPLOAD_ACCEPT[kind]}
                    disabled={disabled || uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setUploadError("");
                      setUploading(true);
                      void onUpload(file)
                        .then((stored) => {
                          // `accept` only steers the file chooser, and the server reads
                          // the real format from the bytes. Binding audio to an image
                          // would reach the assembled module, so refuse it here and say
                          // so; the file itself stays in the library.
                          if (stored.kind !== kind)
                            setUploadError(S.activities.uploadWrongKind(stored.kind));
                          else onChange(stored.path);
                        })
                        .catch((error: unknown) =>
                          setUploadError(error instanceof Error ? error.message : String(error)),
                        )
                        .finally(() => setUploading(false));
                    }}
                  />
                  {uploading ? S.activities.uploading : S.activities.uploadFile}
                </label>
                {uploadError && (
                  <p role="alert" className={`break-words text-xs ${toneInk.danger}`}>
                    {uploadError}
                  </p>
                )}
              </div>
              <div className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
                <p className="text-xs font-medium">{S.activities.libraryTitle}</p>
                <p className="text-xs text-gray-500">{S.activities.libraryHint}</p>
                <Button size="sm" disabled={disabled} onClick={() => setLibraryOpen(true)}>
                  {S.activities.libraryOpen}
                </Button>
              </div>
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
            </div>
            {libraryOpen && (
              <MediaLibraryModal
                media={media}
                type={asset.type}
                endpoint={endpoint}
                loading={mediaLoading}
                onClose={() => setLibraryOpen(false)}
                onPick={(path) => {
                  onChange(path);
                  setLibraryOpen(false);
                }}
              />
            )}
            {asset.path && (
              <Button size="sm" disabled={disabled} onClick={() => onChange(undefined)}>
                {S.activities.clearBinding}
              </Button>
            )}
          </>
        )
      )}
    </div>
  );
}
