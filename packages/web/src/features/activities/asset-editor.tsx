/**
 * The detail pane of the activity workspace: everything about the one scene asset the
 * rail has selected. It fills its column, scrolls on its own, and keeps the binding and
 * its save action pinned to the bottom so the primary action is never scrolled away.
 */
import { useState, type ReactNode } from "react";
import type {
  AssetManifest,
  ActivityRunSummary,
  MediaStat,
  SoundProviderStatus,
  SpeechProviderId,
  SpeechProviderStatus,
  ElevenLabsVoicesProblem,
  UploadedMedia,
  VoiceOption,
} from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk, toneSurface } from "../../lib/tone";
import { ImagePreview } from "./image-preview";
import { MediaBinding } from "./media-binding";
import { MediaComparison } from "./media-comparison";
import { AudioAssetEditor, AudioViewToggle, type AudioView } from "./audio-asset-editor";
import { isUploadPath } from "./media-library";
import { MediaPlayer } from "./media-player";
import { WaveformPlayer } from "./waveform-player";
import { MediaTextReview } from "./media-text-review";
import type { SceneAssetSelection } from "./scene-asset-tree";
import { MediaDetailsView } from "./media-details-view";
import { fileFactsFor } from "./media-details";
import { BookWordFields } from "./book-word-fields";
import { PhonemeTimelineView } from "./phoneme-timeline-view";
import { isBookWord } from "./book-words";
import { SceneCompositionView } from "./scene-composition-view";
import { recordingUrl } from "./scene-video";

export function AssetEditor({
  manifest,
  language,
  selection,
  media,
  mediaLoading,
  runs,
  endpoint,
  editable,
  disabled,
  canGenerate,
  canGenerateMedia = canGenerate,
  canAccept,
  canPreview,
  revision,
  voices,
  defaultVoice,
  mediaDirty,
  mediaSave = null,
  onChange,
  onSaveMedia,
  onGenerateAudio,
  onGenerateSound,
  soundProviders = null,
  speechProviders = null,
  voiceLibrary = null,
  onReloadVoices,
  onGenerateImage,
  onAcceptAudio,
  onAcceptImage,
  onGenerateText,
  onAcceptText,
  onUpload,
  onMediaCopied,
  sceneNav,
  onTranslate,
  defaultLanguage = "en-US",
  languageName = (code) => code,
  mediaStats,
  savedManifest,
  onSaveSounds,
  onCompose,
  onRecordVideo,
  onAcceptVideo,
  spec,
}: {
  manifest: AssetManifest;
  /** The language group the rail is showing. */
  language: string;
  /** The scene and key the rail selected, or null when it has nothing to show. */
  selection: SceneAssetSelection | null;
  media: readonly UploadedMedia[];
  mediaLoading: boolean;
  runs: ActivityRunSummary[];
  endpoint: string;
  editable: boolean;
  disabled: boolean;
  canGenerate: boolean;
  /** Speech and image runs, which only a Penguin agent can make; defaults to `canGenerate`. */
  canGenerateMedia?: boolean;
  canAccept: boolean;
  canPreview: boolean;
  revision: string;
  /** The voices a narration can be spoken in. */
  voices: readonly VoiceOption[];
  /** The voice a narration naming none of its own is generated with. */
  defaultVoice: string;
  /** Whether the manifest holds edits the server has not seen. */
  mediaDirty: boolean;
  /** Where the autosave of this editor's own edits stands; null before the first one. */
  mediaSave?: "pending" | "saving" | "saved" | "failed" | null;
  onChange: (manifest: AssetManifest) => void;
  onSaveMedia: () => void;
  onGenerateAudio: (
    language: string,
    assetKey: string,
    voice: string,
    provider: SpeechProviderId,
  ) => void;
  /** Make a music or sound-effect candidate with the named provider. */
  onGenerateSound?: (language: string, assetKey: string, provider: string, model?: string) => void;
  /** The sound providers the chosen agent can use; null while unknown or without one. */
  soundProviders?: readonly SoundProviderStatus[] | null;
  /** The speech providers the chosen agent can use; null while unknown or without one. */
  speechProviders?: readonly SpeechProviderStatus[] | null;
  /** Whether the Media Agent's ElevenLabs library is loading, and why it could not be listed. */
  voiceLibrary?: { problem: ElevenLabsVoicesProblem | null; loading: boolean } | null;
  /** Read the ElevenLabs library again, past the server's ten-minute list. */
  onReloadVoices?: () => void;
  onGenerateImage: (language: string, assetKey: string) => void;
  /** Bind a speech or sound take; the cards show "Saving…" until it settles. */
  onAcceptAudio: (runId: string) => void | Promise<unknown>;
  onAcceptImage: (runId: string) => void;
  onGenerateText: (language: string, assetKey: string) => void;
  onAcceptText: (runId: string) => void;
  onUpload: (file: File) => Promise<UploadedMedia>;
  /** A file was copied in from another activity of the project. */
  onMediaCopied?: () => void;
  /** Translate a narration into `language` from the default language. */
  onTranslate?: (language: string, assetKey: string) => void;
  defaultLanguage?: string;
  /** How a language is named to the author: its label, else its code. */
  languageName?: (code: string) => string;
  /** The server's media stats for the saved draft: undefined while loading, null if unreadable. */
  mediaStats?: readonly MediaStat[] | null;
  /** The media plan as saved, which is what `mediaStats` describes. */
  savedManifest?: AssetManifest;
  /** Save the author's sounds for a decodable book's word. */
  onSaveSounds?: (language: string, assetKey: string, phonemes: string[]) => void;
  /**
   * Ask an agent to compose the scene of a video or animation asset. Given only while the
   * scene-video experiment is on; absent, the editor shows nothing of it.
   */
  onCompose?: (language: string, assetKey: string) => void;
  /** Record a kept composition to a video (experimental, like `onCompose`). */
  onRecordVideo?: (compositionRunId: string) => void;
  /** Bind a recorded video to its asset. */
  onAcceptVideo?: (runId: string) => void;
  /** The saved specification, for the scene-video advisory about learner choices. */
  spec?: unknown;
  /**
   * Where this asset's scene sits on the storyboard: its name, the way back to the board,
   * and the scenes either side. Absent for media no scene uses.
   */
  sceneNav?: {
    label: string;
    onBoard: () => void;
    previous: { label: string; open: () => void } | null;
    next: { label: string; open: () => void } | null;
  };
}) {
  // An upload that would replace a bound file, held beside it until the author chooses.
  const [pendingUpload, setPendingUpload] = useState<{
    language: string;
    key: string;
    stored: UploadedMedia;
  } | null>(null);
  // New takes the author chose to keep the current media over; they stay in the candidates.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  // A clip's length, once a waveform on this page has decoded it.
  const [decoded, setDecoded] = useState<{ src: string; seconds: number } | null>(null);
  const group = manifest.assets[language] ?? [];
  const asset = group.find((entry) => entry.key === selection?.key);
  // Narration, music and effects are edited in every language at once (audio-asset-editor);
  // a book word keeps its own editor below.
  const cards = asset?.type === "audio" && !isBookWord(asset);
  // Which view the cards show; the page's own, never saved.
  const [audioView, setAudioView] = useState<AudioView>("simplified");
  // Where the recording's player is, which sound the word's timeline marks. Choosing another
  // asset starts it afresh, so one clip's position is never marked on another's sounds.
  const [playhead, setPlayhead] = useState(0);
  const shownAsset = `${language}/${asset?.key ?? ""}`;
  const [stateFor, setStateFor] = useState(shownAsset);
  if (stateFor !== shownAsset) {
    setStateFor(shownAsset);
    setPlayhead(0);
  }
  const imageUrl = `${endpoint}/media-image?${new URLSearchParams({
    language,
    assetKey: asset?.key ?? "",
    expectedRevision: revision,
  })}`;
  const audioUrl = (runId: string) => `${endpoint}/runs/${encodeURIComponent(runId)}/audio`;
  const generatedImageUrl = (runId: string) =>
    `${endpoint}/runs/${encodeURIComponent(runId)}/image`;
  const videoUrl = (runId: string) => recordingUrl(endpoint, runId);
  /**
   * Store a trimmed clip as an upload and bind the asset to it. The file is no longer the
   * one a speech run produced, so the asset stops claiming that run's output.
   */
  async function trimTo(wav: Uint8Array) {
    if (!asset) return;
    const stored = await onUpload(
      new File([wav as BlobPart], `${asset.key}-trimmed.wav`, { type: "audio/wav" }),
    );
    edit((entry) => {
      entry.path = stored.path;
      delete entry.generatedAudio;
      delete entry.wordTimings;
      delete entry.durationMs;
      delete entry.phonemeTimings;
      delete entry.wholeWordTiming;
    });
  }
  const uploadUrl = (path: string) => `${endpoint}/media-upload?path=${encodeURIComponent(path)}`;
  function bindPath(path: string | undefined) {
    edit((entry) => {
      // A recording is bound only at its own path; another file is no longer it.
      if (entry.generatedVideo && entry.path !== path) delete entry.generatedVideo;
      if (path) entry.path = path;
      else delete entry.path;
      // Timings describe the recording that was bound, not this one.
      delete entry.wordTimings;
      delete entry.durationMs;
      delete entry.phonemeTimings;
      delete entry.wholeWordTiming;
    });
  }
  /** The media bound now, played or shown as the comparison's first half. */
  function currentMedia(): ReactNode {
    if (!asset?.path) return null;
    const label = S.activities.mediaComparison.current;
    if (asset.type === "audio" && asset.generatedAudio)
      return <WaveformPlayer src={audioUrl(asset.generatedAudio.runId)} label={label} autoLoad />;
    if (asset.type === "image" && asset.generatedImage)
      return (
        <ImagePreview
          src={generatedImageUrl(asset.generatedImage.runId)}
          description={asset.description}
        />
      );
    if (asset.generatedVideo)
      return <MediaPlayer kind="video" src={videoUrl(asset.generatedVideo.runId)} label={label} />;
    if (isUploadPath(asset.path)) return uploadedMedia(asset.path, label);
    if (asset.type === "image" && canPreview)
      return <ImagePreview src={imageUrl} description={asset.description} />;
    return (
      <p className="break-words text-xs text-gray-500">
        {S.activities.mediaComparison.noPreview(asset.path)}
      </p>
    );
  }
  function uploadedMedia(path: string, label: string): ReactNode {
    if (!asset) return null;
    if (asset.type === "audio")
      return <WaveformPlayer src={uploadUrl(path)} label={label} autoLoad />;
    if (asset.type === "image")
      return <ImagePreview src={uploadUrl(path)} description={asset.description} />;
    return <MediaPlayer kind="video" src={uploadUrl(path)} label={label} />;
  }
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
  // The newest take that could replace bound media, compared with it rather than listed.
  const compared = asset?.path
    ? [...(asset.type === "audio" ? audioCandidates : imageCandidates)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .find(
          (run) =>
            run.status === "succeeded" &&
            run.hasCandidate &&
            run.inputRevision === revision &&
            run.runId !== (asset.generatedAudio ?? asset.generatedImage)?.runId &&
            !kept.has(run.runId),
        )
    : undefined;
  const upload =
    pendingUpload && pendingUpload.language === language && pendingUpload.key === asset?.key
      ? pendingUpload.stored
      : null;
  const acceptedImage = runs.find((run) => run.runId === asset?.generatedImage?.runId)?.image;
  const uploadSrc = asset?.path ? uploadUrl(asset.path) : "";
  const acceptedSrc = asset?.generatedAudio ? audioUrl(asset.generatedAudio.runId) : "";
  // Where the bound file plays from, which is where its details are read.
  const detailsSrc = !asset?.path
    ? null
    : asset.type === "audio" && asset.generatedAudio
      ? acceptedSrc
      : asset.generatedVideo
        ? videoUrl(asset.generatedVideo.runId)
        : isUploadPath(asset.path)
          ? uploadSrc
          : asset.path.startsWith("media/")
            ? `${endpoint}/sandbox/media/${asset.path
                .slice("media/".length)
                .split("/")
                .map(encodeURIComponent)
                .join("/")}`
            : null;
  const details =
    asset?.path && detailsSrc && (asset.type === "audio" || asset.type === "video") ? (
      <MediaDetailsView
        key={detailsSrc}
        kind={asset.type}
        src={detailsSrc}
        file={fileFactsFor({
          path: asset.path,
          language,
          assetKey: asset.key,
          uploads: media,
          stats: mediaStats,
          saved: savedManifest,
        })}
        seconds={decoded?.src === detailsSrc ? decoded.seconds : undefined}
      />
    ) : null;
  return (
    <section aria-label={S.activities.sceneAssets} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sceneNav && (
        <nav
          aria-label={S.activities.studioBoard.back}
          className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1 text-xs dark:border-gray-800"
        >
          <Button size="sm" variant="ghost" onClick={sceneNav.onBoard}>
            {S.activities.studioBoard.back}
          </Button>
          <span aria-hidden className="text-gray-300 dark:text-gray-700">
            /
          </span>
          <span className="min-w-0 flex-1 truncate px-1 text-gray-600 dark:text-gray-400">
            {sceneNav.label}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!sceneNav.previous}
            aria-label={
              sceneNav.previous
                ? S.activities.studioBoard.previousScene(sceneNav.previous.label)
                : S.activities.studioBoard.previous
            }
            onClick={() => sceneNav.previous?.open()}
          >
            {S.activities.studioBoard.previous}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!sceneNav.next}
            aria-label={
              sceneNav.next
                ? S.activities.studioBoard.nextScene(sceneNav.next.label)
                : S.activities.studioBoard.next
            }
            onClick={() => sceneNav.next?.open()}
          >
            {S.activities.studioBoard.next}
          </Button>
        </nav>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {asset ? asset.key : S.activities.sceneAssets}
          </h3>
          {asset && (
            <p className="truncate text-xs text-gray-500">
              {selection?.sceneId ? `${selection.sceneId} · ` : ""}
              {S.activities.mediaTypes[asset.type]}
            </p>
          )}
        </div>
        {cards && <AudioViewToggle value={audioView} onChange={setAudioView} />}
        {asset && !cards && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${asset.path ? toneSurface.success : toneSurface.attention}`}
          >
            {asset.path ? S.activities.boundMedia : S.activities.unboundMedia}
          </span>
        )}
        {!cards && asset?.path?.startsWith("media/") && (
          // Served as the player finds it: the draft's own media, then the checkout's.
          <a
            href={`${endpoint}/sandbox/media/${asset.path
              .slice("media/".length)
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`}
            download={asset.path.split("/").pop()}
            className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-300"
          >
            {S.activities.downloadCurrent}
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!asset ? (
          <p className="text-sm text-gray-500">{S.activities.chooseSceneAsset}</p>
        ) : cards ? (
          <div className="mx-auto max-w-5xl">
            <AudioAssetEditor
              view={audioView}
              manifest={manifest}
              assetKey={asset.key}
              defaultLanguage={defaultLanguage}
              languageName={languageName}
              onChange={onChange}
              media={media}
              mediaLoading={mediaLoading}
              runs={runs}
              endpoint={endpoint}
              editable={editable}
              disabled={disabled}
              canGenerate={canGenerate}
              canGenerateMedia={canGenerateMedia}
              canAccept={canAccept}
              revision={revision}
              voices={voices}
              defaultVoice={defaultVoice}
              speechProviders={speechProviders}
              soundProviders={soundProviders}
              voiceLibrary={voiceLibrary}
              onReloadVoices={onReloadVoices}
              mediaStats={mediaStats}
              savedManifest={savedManifest}
              onGenerateAudio={onGenerateAudio}
              onGenerateSound={onGenerateSound}
              onAcceptAudio={onAcceptAudio}
              onGenerateText={onGenerateText}
              onAcceptText={onAcceptText}
              onTranslate={onTranslate}
              onUpload={onUpload}
              onMediaCopied={onMediaCopied}
            />
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-3">
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
              media={media}
              mediaLoading={mediaLoading}
              endpoint={endpoint}
              editable={editable}
              disabled={disabled}
              onUpload={onUpload}
              onCopied={onMediaCopied}
              onUploaded={(stored) => {
                if (asset.path && asset.path !== stored.path)
                  setPendingUpload({ language, key: asset.key, stored });
                else bindPath(stored.path);
              }}
              onChange={bindPath}
            />
            {upload && (
              <MediaComparison
                current={currentMedia()}
                next={uploadedMedia(upload.path, S.activities.mediaComparison.next)}
                disabled={!editable || disabled}
                onUse={() => {
                  bindPath(upload.path);
                  setPendingUpload(null);
                }}
                onKeep={() => setPendingUpload(null)}
              />
            )}
            {compared && editable && (
              <MediaComparison
                current={currentMedia()}
                next={
                  asset.type === "audio" ? (
                    <WaveformPlayer
                      key={compared.runId}
                      src={audioUrl(compared.runId)}
                      label={S.activities.mediaComparison.next}
                      autoLoad
                    />
                  ) : (
                    <ImagePreview
                      key={compared.runId}
                      src={generatedImageUrl(compared.runId)}
                      description={compared.image?.prompt ?? asset.description}
                    />
                  )
                }
                disabled={!canAccept}
                onUse={() =>
                  asset.type === "audio"
                    ? onAcceptAudio(compared.runId)
                    : onAcceptImage(compared.runId)
                }
                onKeep={() => setKept((previous) => new Set(previous).add(compared.runId))}
              />
            )}
            {asset.type === "audio" && !asset.generatedAudio && isUploadPath(asset.path) && (
              <WaveformPlayer
                src={uploadSrc}
                label={asset.key}
                onTrim={editable && !disabled ? trimTo : undefined}
                onDecoded={(seconds) => setDecoded({ src: uploadSrc, seconds })}
                onTime={isBookWord(asset) ? setPlayhead : undefined}
              />
            )}
            {asset.type === "audio" && !asset.generatedAudio && details}
            {(asset.type === "video" || asset.type === "animation") &&
              (asset.generatedVideo ? (
                <MediaPlayer
                  key={asset.generatedVideo.runId}
                  kind="video"
                  src={videoUrl(asset.generatedVideo.runId)}
                  label={S.activities.video.recorded}
                />
              ) : isUploadPath(asset.path) ? (
                <MediaPlayer
                  kind="video"
                  src={`${endpoint}/media-upload?path=${encodeURIComponent(asset.path!)}`}
                  label={asset.key}
                />
              ) : (
                <p className="text-xs text-gray-500">{S.activities.noInAppPreview}</p>
              ))}
            {asset.type === "video" && details}
            {(asset.type === "video" || asset.type === "animation") && onCompose && (
              <SceneCompositionView
                asset={asset}
                group={group}
                language={language}
                runs={runs}
                endpoint={endpoint}
                revision={revision}
                editable={editable}
                canGenerate={canGenerate}
                spec={spec}
                onCompose={onCompose}
                canRecord={canAccept}
                onRecord={onRecordVideo}
                onAcceptVideo={onAcceptVideo}
                current={currentMedia() ?? undefined}
              />
            )}
            {asset.type === "audio" && isBookWord(asset) && (
              <>
                <BookWordFields
                  key={`${language}/${asset.key}/${(asset.phonemes ?? []).join(" ")}`}
                  asset={asset}
                  editable={editable && !!onSaveSounds}
                  canSave={canAccept && !disabled}
                  onSave={(phonemes) => onSaveSounds?.(language, asset.key, phonemes)}
                  onEdit={editable && !disabled ? edit : undefined}
                />
                <section className="space-y-1" aria-label={S.activities.bookWords.recording}>
                  <p className="text-xs font-medium">{S.activities.bookWords.recording}</p>
                  {asset.generatedAudio && (
                    <WaveformPlayer
                      key={asset.generatedAudio.runId}
                      src={acceptedSrc}
                      label={S.activities.bookWords.recording}
                      autoLoad
                      onDecoded={(seconds) => setDecoded({ src: acceptedSrc, seconds })}
                      onTime={setPlayhead}
                    />
                  )}
                  {!asset.path ? (
                    <p className="text-xs text-gray-500">{S.activities.bookWords.noRecording}</p>
                  ) : asset.generatedAudio || isUploadPath(asset.path) ? (
                    // The recording's player (here, or the upload's above) moves the playhead.
                    <PhonemeTimelineView asset={asset} seconds={playhead} />
                  ) : (
                    <p className="text-xs text-gray-500">{S.activities.noInAppPreview}</p>
                  )}
                  {asset.generatedAudio && details}
                </section>
              </>
            )}
            {asset.type === "image" && (
              <>
                {editable && (
                  <Button
                    size="sm"
                    disabled={
                      !canGenerateMedia ||
                      !asset.description.trim() ||
                      asset.description.length > 5000
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
                          {new Date(run.createdAt).toLocaleString()} ·{" "}
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
          </div>
        )}
      </div>
      {editable && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-2.5 dark:border-gray-800">
          {/* Each language card shows its own binding. */}
          <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
            {cards ? "" : asset?.path ? asset.path : S.activities.unboundMedia}
          </p>
          {/* Edits here save themselves; the button is for a save that failed, or for
              manifest edits made elsewhere (the JSON in Media Library). */}
          {mediaSave && (mediaDirty || mediaSave === "saved") && (
            <p
              role="status"
              className={`text-xs ${mediaSave === "failed" ? toneInk.danger : "text-gray-500"}`}
            >
              {S.activities.studioScript.autosave[mediaSave]}
            </p>
          )}
          {mediaDirty && mediaSave !== "pending" && mediaSave !== "saving" && (
            <Button size="sm" variant="primary" disabled={disabled} onClick={onSaveMedia}>
              {S.activities.saveMedia}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
