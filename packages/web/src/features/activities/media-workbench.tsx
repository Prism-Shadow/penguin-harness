import { useState } from "react";
import type { AssetManifest, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk, toneSurface } from "../../lib/tone";
import { ImagePreview } from "./image-preview";
import { MediaBinding } from "./media-binding";
import { MediaTextReview } from "./media-text-review";
import {
  SceneAssetTree,
  firstSelection,
  sameSelection,
  type SceneAssetSelection,
} from "./scene-asset-tree";
import { buildSceneTree, filterTree, treeSelections, type SceneAssetType } from "./scene-assets";

export function MediaWorkbench({
  manifest,
  spec,
  runs,
  endpoint,
  editable,
  disabled,
  canGenerate,
  canAccept,
  canPreview,
  wafRoot,
  revision,
  voices,
  onChange,
  onGenerateAudio,
  onGenerateImage,
  onAcceptAudio,
  onAcceptImage,
  onGenerateText,
  onAcceptText,
}: {
  manifest: AssetManifest;
  /** The saved specification owns scene order, which the tree follows. */
  spec: Record<string, unknown> | null;
  runs: ActivityRunSummary[];
  endpoint: string;
  editable: boolean;
  disabled: boolean;
  canGenerate: boolean;
  canAccept: boolean;
  canPreview: boolean;
  wafRoot: string;
  revision: string;
  voices: string[];
  onChange: (manifest: AssetManifest) => void;
  onGenerateAudio: (language: string, assetKey: string, voice: string) => void;
  onGenerateImage: (language: string, assetKey: string) => void;
  onAcceptAudio: (runId: string) => void;
  onAcceptImage: (runId: string) => void;
  onGenerateText: (language: string, assetKey: string) => void;
  onAcceptText: (runId: string) => void;
}) {
  const [languageChoice, setLanguage] = useState("");
  const [kind, setKind] = useState<SceneAssetType | "all">("all");
  const [selected, setSelected] = useState<SceneAssetSelection | null>(null);
  const [voiceChoice, setVoice] = useState("");
  const language = manifest.assets[languageChoice]
    ? languageChoice
    : (Object.keys(manifest.assets)[0] ?? "en-US");
  const group = manifest.assets[language] ?? [];
  const tree = filterTree(buildSceneTree(spec, group), kind);
  // A selection the filter or a rebuilt plan removed falls back to the first leaf,
  // so the detail panel never points at an asset the tree no longer draws.
  const drawn = treeSelections(tree);
  const selection =
    selected && drawn.some((entry) => sameSelection(entry, selected))
      ? selected
      : firstSelection(tree);
  const asset = group.find((entry) => entry.key === selection?.key);
  const voice = voices.includes(voiceChoice) ? voiceChoice : (voices[0] ?? "");
  const imageUrl = `${endpoint}/media-image?${new URLSearchParams({
    language,
    assetKey: asset?.key ?? "",
    expectedRevision: revision,
    ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
  })}`;
  const audioUrl = (runId: string) => `${endpoint}/runs/${encodeURIComponent(runId)}/audio`;
  const generatedImageUrl = (runId: string) =>
    `${endpoint}/runs/${encodeURIComponent(runId)}/image`;
  function edit(change: (entry: NonNullable<typeof asset>) => void) {
    if (!asset || !editable || disabled) return;
    const updated = structuredClone(manifest);
    change(updated.assets[language]!.find((entry) => entry.key === asset.key)!);
    onChange(updated);
  }
  const audioCandidates = runs.filter(
    (run) =>
      run.kind === "audio" &&
      run.audio?.language === language &&
      run.audio?.assetKey === asset?.key,
  );
  const imageCandidates = runs.filter(
    (run) =>
      run.kind === "image" &&
      run.image?.language === language &&
      run.image?.assetKey === asset?.key,
  );
  const textCandidates = runs.filter(
    (run) =>
      run.kind === "media-text" &&
      run.mediaText?.language === language &&
      run.mediaText?.assetKey === asset?.key &&
      run.mediaText?.type === asset?.type,
  );
  const acceptedImage = runs.find((run) => run.runId === asset?.generatedImage?.runId)?.image;
  const acceptedAudio = runs.find((run) => run.runId === asset?.generatedAudio?.runId)?.audio;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          size="sm"
          label={S.activities.mediaLanguage}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {Object.keys(manifest.assets).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          label={S.activities.mediaType}
          value={kind}
          onChange={(event) => setKind(event.target.value as SceneAssetType | "all")}
        >
          {(["all", "audio", "image", "video", "animation"] as const).map((type) => (
            <option key={type} value={type}>
              {S.activities.mediaTypes[type]}
            </option>
          ))}
        </Select>
      </div>
      {!asset ? (
        <p className="text-sm text-gray-500">{S.activities.noMediaAssets}</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div
            aria-label={S.activities.sceneAssets}
            className="max-h-96 overflow-auto rounded-lg border border-gray-200 p-2 dark:border-gray-800"
          >
            <SceneAssetTree tree={tree} selection={selection} onSelect={setSelected} />
          </div>
          <article className="min-w-0 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="break-all text-sm font-semibold">
                {selection?.sceneId ? `${selection.sceneId} · ${asset.key}` : asset.key}
              </h4>
              <span
                className={`rounded px-2 py-0.5 text-xs ${asset.path ? toneSurface.success : toneSurface.attention}`}
              >
                {asset.path ? S.activities.boundMedia : S.activities.unboundMedia}
              </span>
            </div>
            {asset.type === "image" ? (
              <Textarea
                size="sm"
                label={S.activities.imageDescription}
                hint={S.activities.imageDescriptionHint}
                rows={4}
                maxLength={5000}
                value={asset.description}
                disabled={!editable || disabled}
                onChange={(event) =>
                  edit((entry) => {
                    entry.description = event.target.value;
                  })
                }
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">{asset.description}</p>
            )}
            {asset.type === "image" && editable && (
              <Button
                size="sm"
                disabled={!canGenerate}
                onClick={() => onGenerateText(language, asset.key)}
              >
                {S.activities.improveImagePrompt}
              </Button>
            )}
            {asset.type === "image" &&
              editable &&
              !asset.generatedImage &&
              (!asset.path ? (
                <p className="text-xs text-gray-500">{S.activities.imageUnbound}</p>
              ) : !canPreview ? (
                <p className="text-xs text-gray-500">{S.activities.imageSaveFirst}</p>
              ) : (
                <ImagePreview key={imageUrl} src={imageUrl} description={asset.description} />
              ))}
            {asset.type === "image" && asset.generatedImage && (
              <section className="space-y-1" aria-label={S.activities.acceptedImage}>
                <p className="text-xs font-medium">{S.activities.acceptedImage}</p>
                {acceptedImage && acceptedImage.prompt !== asset.description && (
                  <p className={`text-xs ${toneInk.attention}`}>{S.activities.mediaTextChanged}</p>
                )}
                <ImagePreview
                  key={`${endpoint}/${asset.generatedImage.runId}`}
                  src={generatedImageUrl(asset.generatedImage.runId)}
                  description={asset.description}
                />
              </section>
            )}
            <p className="break-words text-xs text-gray-500">
              {S.activities.usedInScenes}:{" "}
              {[...new Set(asset.usages.map((usage) => usage.sceneId))].join(", ") ||
                S.activities.noSceneUsage}
            </p>
            <MediaBinding
              asset={asset}
              siblings={group}
              editable={editable}
              disabled={disabled}
              onChange={(path) =>
                edit((entry) => {
                  if (path) entry.path = path;
                  else delete entry.path;
                })
              }
            />
            {(asset.type === "video" || asset.type === "animation") && (
              <p className="text-xs text-gray-500">{S.activities.noInAppPreview}</p>
            )}
            {asset.type === "audio" && (
              <>
                <Textarea
                  size="sm"
                  label={S.activities.speechScript}
                  hint={S.activities.speechScriptHint}
                  rows={4}
                  maxLength={5000}
                  value={asset.script ?? ""}
                  disabled={!editable || disabled}
                  onChange={(event) =>
                    edit((entry) => {
                      entry.script = event.target.value;
                    })
                  }
                />
                {editable && (
                  <Button
                    size="sm"
                    disabled={!canGenerate}
                    onClick={() => onGenerateText(language, asset.key)}
                  >
                    {S.activities.improveNarration}
                  </Button>
                )}
                {asset.generatedAudio && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">{S.activities.acceptedAudio}</p>
                    {acceptedAudio && acceptedAudio.script !== asset.script && (
                      <p className={`text-xs ${toneInk.attention}`}>
                        {S.activities.mediaTextChanged}
                      </p>
                    )}
                    <audio
                      key={asset.generatedAudio.runId}
                      aria-label={S.activities.acceptedAudio}
                      controls
                      preload="none"
                      src={audioUrl(asset.generatedAudio.runId)}
                      className="w-full"
                    />
                  </div>
                )}
                {editable && (
                  <>
                    <Select
                      size="sm"
                      label={S.activities.speechVoice}
                      value={voice}
                      disabled={disabled}
                      onChange={(event) => setVoice(event.target.value)}
                    >
                      {voices.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={
                        !canGenerate ||
                        !voice ||
                        !asset.script?.trim() ||
                        asset.script.length > 5000
                      }
                      onClick={() => onGenerateAudio(language, asset.key, voice)}
                    >
                      {asset.path ? S.activities.regenerateSpeech : S.activities.generateSpeech}
                    </Button>
                  </>
                )}
                {audioCandidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.speechCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.speechCandidates}</h5>
                    {audioCandidates.map((run) => (
                      <div
                        key={run.runId}
                        className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
                      >
                        <p className="text-xs">
                          {run.audio?.voice} · {new Date(run.createdAt).toLocaleString()} ·{" "}
                          {S.activities.speechStatus[run.status]}
                        </p>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.hasCandidate &&
                          (run.status === "succeeded" || run.status === "conflict") && (
                            <audio
                              aria-label={S.activities.speechCandidate}
                              controls
                              preload="none"
                              src={audioUrl(run.runId)}
                              className="w-full"
                            />
                          )}
                        {editable &&
                          run.status === "succeeded" &&
                          run.runId !== asset.generatedAudio?.runId && (
                            <Button
                              size="sm"
                              disabled={!canAccept || run.inputRevision !== revision}
                              onClick={() => onAcceptAudio(run.runId)}
                            >
                              {S.activities.acceptSpeech}
                            </Button>
                          )}
                        {run.inputRevision !== revision &&
                          run.runId !== asset.generatedAudio?.runId && (
                            <p className="text-xs text-gray-500">{S.activities.olderSpeech}</p>
                          )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
            {asset.type === "image" && (
              <>
                {editable && (
                  <Button
                    size="sm"
                    disabled={
                      !canGenerate || !asset.description.trim() || asset.description.length > 5000
                    }
                    onClick={() => onGenerateImage(language, asset.key)}
                  >
                    {asset.generatedImage
                      ? S.activities.regenerateImage
                      : S.activities.generateImage}
                  </Button>
                )}
                {imageCandidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.imageCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.imageCandidates}</h5>
                    {imageCandidates.map((run) => (
                      <div
                        key={run.runId}
                        className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
                      >
                        <p className="text-xs">
                          {new Date(run.createdAt).toLocaleString()} Â·{" "}
                          {S.activities.speechStatus[run.status]}
                        </p>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.hasCandidate &&
                          (run.status === "succeeded" || run.status === "conflict") && (
                            <ImagePreview
                              key={`${endpoint}/${run.runId}`}
                              src={generatedImageUrl(run.runId)}
                              description={run.image?.prompt ?? asset.description}
                            />
                          )}
                        {editable &&
                          run.status === "succeeded" &&
                          run.runId !== asset.generatedImage?.runId && (
                            <Button
                              size="sm"
                              disabled={!canAccept || run.inputRevision !== revision}
                              onClick={() => onAcceptImage(run.runId)}
                            >
                              {S.activities.acceptImage}
                            </Button>
                          )}
                        {run.inputRevision !== revision &&
                          run.runId !== asset.generatedImage?.runId && (
                            <p className="text-xs text-gray-500">{S.activities.olderImage}</p>
                          )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
            {(asset.type === "image" || asset.type === "audio") && (
              <>
                {textCandidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.textCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.textCandidates}</h5>
                    {textCandidates.map((run) => (
                      <div
                        key={run.runId}
                        className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
                      >
                        <p className="text-xs">
                          {new Date(run.createdAt).toLocaleString()} ·{" "}
                          {S.activities.speechStatus[run.status]}
                        </p>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.hasCandidate &&
                          (run.status === "succeeded" || run.status === "conflict") && (
                            <MediaTextReview
                              key={`${endpoint}/${run.runId}`}
                              endpoint={`${endpoint}/runs/${encodeURIComponent(run.runId)}/candidate`}
                              target={run.mediaText!}
                              currentText={
                                asset.type === "image" ? asset.description : (asset.script ?? "")
                              }
                              stale={run.inputRevision !== revision}
                              editable={editable && run.status === "succeeded"}
                              canAccept={canAccept && run.inputRevision === revision}
                              onAccept={() => onAcceptText(run.runId)}
                            />
                          )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
