import { useState } from "react";
import type { AssetManifest, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneSurface } from "../../lib/tone";
import { ImagePreview } from "./image-preview";

export function MediaWorkbench({
  manifest,
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
  onGenerate,
  onAccept,
}: {
  manifest: AssetManifest;
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
  onGenerate: (language: string, assetKey: string, voice: string) => void;
  onAccept: (runId: string) => void;
}) {
  const [languageChoice, setLanguage] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState("");
  const [voiceChoice, setVoice] = useState("");
  const language = manifest.assets[languageChoice]
    ? languageChoice
    : (Object.keys(manifest.assets)[0] ?? "en-US");
  const entries = (manifest.assets[language] ?? []).filter(
    (asset) => kind === "all" || asset.type === kind,
  );
  const asset = entries.find((entry) => entry.key === selected) ?? entries[0];
  const voice = voices.includes(voiceChoice) ? voiceChoice : (voices[0] ?? "");
  const imageUrl = `${endpoint}/media-image?${new URLSearchParams({
    language,
    assetKey: asset?.key ?? "",
    expectedRevision: revision,
    ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
  })}`;
  const audioUrl = (runId: string) => `${endpoint}/runs/${encodeURIComponent(runId)}/audio`;
  function edit(change: (entry: NonNullable<typeof asset>) => void) {
    if (!asset || !editable || disabled) return;
    const updated = structuredClone(manifest);
    change(updated.assets[language]!.find((entry) => entry.key === asset.key)!);
    onChange(updated);
  }
  const candidates = runs.filter(
    (run) =>
      run.kind === "audio" &&
      run.audio?.language === language &&
      run.audio?.assetKey === asset?.key,
  );
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
          onChange={(event) => setKind(event.target.value)}
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
        <div className="grid gap-4 xl:grid-cols-[12rem_minmax(0,1fr)]">
          <div
            aria-label={S.activities.assetList}
            className="flex max-h-80 flex-col gap-1 overflow-auto"
          >
            {entries.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.key === asset.key}
                onClick={() => setSelected(item.key)}
                className={`rounded-md border p-3 text-left text-xs ${item.key === asset.key ? "border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-800" : "border-gray-200 dark:border-gray-800"}`}
              >
                <span className="block break-all font-medium">{item.key}</span>
                <span className="text-gray-500">
                  {S.activities.mediaTypes[item.type]} ·{" "}
                  {item.path ? S.activities.boundMedia : S.activities.unboundMedia}
                </span>
              </button>
            ))}
          </div>
          <article className="min-w-0 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="break-all text-sm font-semibold">{asset.key}</h4>
              <span
                className={`rounded px-2 py-0.5 text-xs ${asset.path ? toneSurface.success : toneSurface.attention}`}
              >
                {asset.path ? S.activities.boundMedia : S.activities.unboundMedia}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{asset.description}</p>
            {asset.type === "image" &&
              editable &&
              (!asset.path ? (
                <p className="text-xs text-gray-500">{S.activities.imageUnbound}</p>
              ) : !canPreview ? (
                <p className="text-xs text-gray-500">{S.activities.imageSaveFirst}</p>
              ) : (
                <ImagePreview key={imageUrl} src={imageUrl} description={asset.description} />
              ))}
            <p className="break-words text-xs text-gray-500">
              {S.activities.usedInScenes}:{" "}
              {[...new Set(asset.usages.map((usage) => usage.sceneId))].join(", ") ||
                S.activities.noSceneUsage}
            </p>
            <Input
              size="sm"
              label={S.activities.assetPath}
              hint={asset.generatedAudio ? undefined : S.activities.assetPathHint}
              value={asset.path ?? ""}
              disabled={!editable || disabled || !!asset.generatedAudio}
              onChange={(event) =>
                edit((entry) => {
                  if (event.target.value) entry.path = event.target.value;
                  else delete entry.path;
                })
              }
            />
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
                {asset.generatedAudio && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">{S.activities.acceptedAudio}</p>
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
                      onClick={() => onGenerate(language, asset.key, voice)}
                    >
                      {asset.path ? S.activities.regenerateSpeech : S.activities.generateSpeech}
                    </Button>
                  </>
                )}
                {candidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.speechCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.speechCandidates}</h5>
                    {candidates.map((run) => (
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
                              onClick={() => onAccept(run.runId)}
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
          </article>
        </div>
      )}
    </div>
  );
}
