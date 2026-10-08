/**
 * A scene audio asset in every language at once, one card each, as Loom edits it. Script,
 * voice and settings save as they are edited (the page's media autosave); a card's Save is
 * the one deliberate step, making its candidate (the newest take, or a file uploaded or
 * trimmed here) that language's audio.
 *
 * Simplified shows what most lines need: voice, script and a player. Advanced adds the audio
 * type, provider and model, the current audio beside the candidate, and the binding tools.
 */
import { useState } from "react";
import type {
  ActivityRunSummary,
  AssetManifest,
  MediaAsset,
  MediaStat,
  SoundProviderStatus,
  SpeechProviderId,
  SpeechProviderStatus,
  ElevenLabsVoicesProblem,
  UploadedMedia,
  VoiceOption,
} from "@prismshadow/penguin-server/api";
import { Button, labelButtonClass } from "../../components/ui/button";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input, Textarea } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { AudioPlaybackFields } from "./audio-playback-fields";
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_MODELS,
  bindCandidateFile,
  boundAudioUrl,
  candidateId,
  candidateUrl,
  cardCandidate,
  cardGenerating,
  cardLanguages,
  newestTake,
  pendingText,
  primaryAction,
  sandboxMediaUrl,
  speechModelOf,
  type AudioCandidate,
  type ElevenLabsModel,
  type PendingAudio,
} from "./audio-cards";
import { MediaBinding } from "./media-binding";
import { MediaDetailsView } from "./media-details-view";
import { fileFactsFor } from "./media-details";
import { UPLOAD_ACCEPT } from "./media-library";
import { MediaTextReview } from "./media-text-review";
import {
  SOUND_PROMPT_MAX,
  canGenerateSound,
  chosenModel,
  chosenProvider,
  lengthText,
  parseLength,
  providerOptions,
  soundFailure,
  soundMaxSeconds,
  soundPromptOf,
  withSoundPrompt,
} from "./sound-model";
import {
  SPEECH_PROVIDERS,
  isElevenLabsVoiceId,
  providerStatus,
  setProvider,
  speechChoice,
  supportsSpeechLanguage,
  voicesFor,
} from "./speech-provider";
import { VoicePicker } from "./voice-picker";
import { WaveformPlayer } from "./waveform-player";
import { WordTimingsView } from "./word-timings-view";

export type AudioView = "simplified" | "advanced";

/** The panel header's switch between the two views; local to the page, never saved. */
export function AudioViewToggle({
  value,
  onChange,
}: {
  value: AudioView;
  onChange: (view: AudioView) => void;
}) {
  const words = S.activities.audioEditor;
  return (
    <div role="group" aria-label={words.view} className="w-48">
      <Segmented
        cols={2}
        value={value}
        onChange={onChange}
        options={[
          { value: "simplified", label: words.simplified },
          { value: "advanced", label: words.advanced },
        ]}
      />
    </div>
  );
}

/** What every card shares: the page's state, providers and actions. */
interface Shared {
  view: AudioView;
  media: readonly UploadedMedia[];
  mediaLoading: boolean;
  runs: readonly ActivityRunSummary[];
  endpoint: string;
  editable: boolean;
  disabled: boolean;
  /** Text runs (translation, script help), which need the chosen agent. */
  canGenerate: boolean;
  /** Speech and sound runs, which the Media Agent makes. */
  canGenerateMedia: boolean;
  canAccept: boolean;
  revision: string;
  voices: readonly VoiceOption[];
  defaultVoice: string;
  speechProviders: readonly SpeechProviderStatus[] | null;
  soundProviders: readonly SoundProviderStatus[] | null;
  voiceLibrary: { problem: ElevenLabsVoicesProblem | null; loading: boolean } | null;
  onReloadVoices?: () => void;
  mediaStats?: readonly MediaStat[] | null;
  savedManifest?: AssetManifest;
  onGenerateAudio: (
    language: string,
    assetKey: string,
    voice: string,
    provider: SpeechProviderId,
  ) => void;
  onGenerateSound?: (language: string, assetKey: string, provider: string, model?: string) => void;
  onAcceptAudio: (runId: string) => void | Promise<unknown>;
  onGenerateText: (language: string, assetKey: string) => void;
  onAcceptText: (runId: string) => void;
  onTranslate?: (language: string, assetKey: string) => void;
  onUpload: (file: File) => Promise<UploadedMedia>;
  onMediaCopied?: () => void;
}

export function AudioAssetEditor({
  manifest,
  assetKey,
  defaultLanguage,
  languageName,
  onChange,
  ...shared
}: Shared & {
  manifest: AssetManifest;
  assetKey: string;
  defaultLanguage: string;
  /** How a language is named to the author: its label, else its code. */
  languageName: (code: string) => string;
  onChange: (manifest: AssetManifest) => void;
}) {
  const languages = cardLanguages(manifest, assetKey, defaultLanguage);
  const source = manifest.assets[defaultLanguage]?.find((entry) => entry.key === assetKey);
  const usage = manifest.assets[languages[0] ?? ""]?.find((entry) => entry.key === assetKey);
  function edit(language: string, change: (entry: MediaAsset) => void) {
    if (!shared.editable || shared.disabled) return;
    const updated = structuredClone(manifest);
    const entry = updated.assets[language]?.find((item) => item.key === assetKey);
    if (!entry) return;
    change(entry);
    onChange(updated);
  }
  return (
    <div className="space-y-4">
      {languages.map((code) => {
        const group = manifest.assets[code] ?? [];
        const asset = group.find((entry) => entry.key === assetKey)!;
        return (
          <AudioCard
            // A card's pending file and typed voice belong to one asset in one language.
            key={`${assetKey}/${code}`}
            {...shared}
            asset={asset}
            group={group}
            language={code}
            name={languageName(code)}
            defaultLanguage={defaultLanguage}
            defaultName={languageName(defaultLanguage)}
            sourceScript={source?.script}
            onEdit={(change) => edit(code, change)}
          />
        );
      })}
      {shared.view === "advanced" && usage && (
        <p className="break-words text-xs text-gray-500">
          {S.activities.usedInScenes}:{" "}
          {[...new Set(usage.usages.map((entry) => entry.sceneId))].join(", ") ||
            S.activities.noSceneUsage}
        </p>
      )}
    </div>
  );
}

function AudioCard({
  view,
  asset,
  group,
  language,
  name,
  defaultLanguage,
  defaultName,
  sourceScript,
  onEdit,
  media,
  mediaLoading,
  runs,
  endpoint,
  editable,
  disabled,
  canGenerate,
  canGenerateMedia,
  canAccept,
  revision,
  voices,
  defaultVoice,
  speechProviders,
  soundProviders,
  voiceLibrary,
  onReloadVoices,
  mediaStats,
  savedManifest,
  onGenerateAudio,
  onGenerateSound,
  onAcceptAudio,
  onGenerateText,
  onAcceptText,
  onTranslate,
  onUpload,
  onMediaCopied,
}: Shared & {
  asset: MediaAsset;
  /** The card language's assets: the pool typed voices and reuse are drawn from. */
  group: readonly MediaAsset[];
  language: string;
  name: string;
  defaultLanguage: string;
  defaultName: string;
  sourceScript: string | undefined;
  onEdit: (change: (entry: MediaAsset) => void) => void;
}) {
  const words = S.activities.audioEditor;
  const advanced = view === "advanced";
  const narration = !asset.kind;
  const locked = !editable || disabled;
  // A file uploaded or trimmed here, waiting for Save; generating replaces it.
  const [pending, setPending] = useState<PendingAudio | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [typedVoice, setTypedVoice] = useState("");
  // Where the current clip's player is, which word the timings mark.
  const [playhead, setPlayhead] = useState(0);
  // Clip lengths the waveforms decoded, so the details need not measure them again.
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const [soundChoice, setSoundChoice] = useState<string | null>(null);
  const [soundModelChoice, setSoundModelChoice] = useState<string | null>(null);
  // The Length field's text while it does not hold a length that can be saved.
  const [lengthDraft, setLengthDraft] = useState<string | null>(null);

  // Who speaks this narration, with which voice.
  const { provider, voice } = speechChoice(asset, voices, defaultVoice, language);
  const providerVoices = voicesFor(voices, provider, group).filter(
    (option) => provider !== "kokoro" || option.languages.includes(language),
  );
  const providerState = providerStatus(speechProviders, provider);
  const providerProblem =
    providerState && !providerState.available
      ? providerState.problem === "runtime_missing"
        ? S.activities.speechProvider.runtimeMissing
        : S.activities.sound.problems.credential_missing(providerState.credential)
      : null;

  // How a music or effect asset is made.
  const soundOptions = asset.kind ? providerOptions(soundProviders ?? [], asset.kind) : [];
  const soundProvider = chosenProvider(soundOptions, soundChoice);
  const soundModel = chosenModel(soundProvider, soundModelChoice);
  const maxSeconds = soundMaxSeconds(soundProvider?.id);
  const lengthValue = lengthDraft ?? lengthText(asset.targetDurationMs);
  const length = parseLength(lengthValue);
  const validLength = length.ok && (length.ms ?? 10000) <= maxSeconds * 1000;
  const prompt = soundPromptOf(asset.script);

  const boundUpload = asset.path ? media.find((entry) => entry.path === asset.path) : undefined;
  const take = newestTake(runs, language, asset.key, revision, {
    runId: asset.generatedAudio?.runId,
    uploadedAt: !asset.generatedAudio ? boundUpload?.updatedAt : undefined,
  });
  const candidate = cardCandidate(take, pending);
  const currentSrc = boundAudioUrl(asset, endpoint);
  const generating = cardGenerating(runs, language, asset.key);
  const text = pendingText(runs, language, asset.key, revision);
  const primary = primaryAction({
    narration,
    language,
    defaultLanguage,
    script: asset.script,
    sourceScript,
    bound: !!asset.path,
  });
  // The newest run's failure, while nothing newer has replaced it.
  const latest = runs
    .filter(
      (run) =>
        run.kind === "audio" &&
        run.audio?.language === language &&
        run.audio?.assetKey === asset.key,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const runError =
    latest && latest.status !== "succeeded" && latest.status !== "running" && latest.error
      ? latest.audio?.sound || latest.audio?.provider === "elevenlabs"
        ? soundFailure(latest.error)
        : latest.error
      : null;

  const canSpeak =
    canGenerateMedia &&
    !generating &&
    !!voice &&
    !providerProblem &&
    !!asset.script?.trim() &&
    asset.script.length <= 5000;
  const canSound =
    canGenerateMedia &&
    !generating &&
    !!onGenerateSound &&
    canGenerateSound(prompt, soundProvider, validLength) &&
    (asset.targetDurationMs ?? 10000) <= maxSeconds * 1000;

  function generate() {
    setPending(null);
    setError("");
    if (narration) onGenerateAudio(language, asset.key, voice, provider);
    else if (soundProvider)
      onGenerateSound?.(
        language,
        asset.key,
        soundProvider.id,
        soundProvider.models.length && soundModel ? soundModel.id : undefined,
      );
  }

  async function save() {
    if (!candidate) return;
    if (candidate.source !== "generated") {
      onEdit((entry) => bindCandidateFile(entry, candidate.path));
      setPending(null);
      return;
    }
    setAccepting(true);
    try {
      await onAcceptAudio(candidate.runId);
    } finally {
      setAccepting(false);
    }
  }

  async function upload(file: File) {
    setError("");
    setUploading(true);
    try {
      const stored = await onUpload(file);
      // `accept` only steers the chooser; the server reads the real format from the bytes.
      if (stored.kind !== "audio") setError(S.activities.uploadWrongKind(stored.kind));
      else setPending({ source: "upload", path: stored.path, name: file.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  }

  /** A trim of either clip is stored as an upload and becomes the card's candidate. */
  async function trim(wav: Uint8Array) {
    const stored = await onUpload(
      new File([wav as BlobPart], `${asset.key}-${language}-trimmed.wav`, { type: "audio/wav" }),
    );
    setPending({ source: "trim", path: stored.path });
  }
  const onTrim = locked ? undefined : trim;

  function candidateLabel(chosen: AudioCandidate): string {
    if (chosen.source === "generated") return words.generatedCandidate;
    if (chosen.source === "trim") return words.trimmedCandidate;
    return words.uploadedCandidate(chosen.name ?? chosen.path.split("/").pop() ?? "");
  }

  function details(src: string, path: string | null) {
    return (
      <MediaDetailsView
        key={`details:${src}`}
        kind="audio"
        src={src}
        file={
          path
            ? fileFactsFor({
                path,
                language,
                assetKey: asset.key,
                uploads: media,
                stats: mediaStats,
                saved: savedManifest,
              })
            : null
        }
        seconds={lengths[src]}
      />
    );
  }

  function player(src: string, label: string, onTime?: (seconds: number) => void) {
    return (
      <WaveformPlayer
        key={`player:${src}`}
        src={src}
        label={label}
        autoLoad
        onTrim={onTrim}
        onDecoded={(seconds) => setLengths((known) => ({ ...known, [src]: seconds }))}
        onTime={onTime}
      />
    );
  }

  /** The bound audio, its player and details, or why there is none to play. */
  function current(label: string) {
    if (currentSrc)
      return (
        <>
          {player(currentSrc, label, narration ? setPlayhead : undefined)}
          {details(currentSrc, asset.path ?? null)}
        </>
      );
    return (
      <p className="break-words text-xs text-gray-500">
        {asset.path ? words.cannotPlay(asset.path) : words.noAudio(name)}
      </p>
    );
  }

  function candidateView(chosen: AudioCandidate) {
    const src = candidateUrl(chosen, endpoint);
    return (
      <div key={candidateId(chosen)} className="space-y-2">
        {player(src, candidateLabel(chosen))}
        {details(src, chosen.source === "generated" ? null : chosen.path)}
      </div>
    );
  }

  const scriptField = narration ? (
    <Textarea
      size="sm"
      label={words.script(name)}
      hint={S.activities.speechScriptHint}
      maxLength={5000}
      className="min-h-36"
      value={asset.script ?? ""}
      disabled={locked}
      onChange={(event) =>
        onEdit((entry) => {
          entry.script = event.target.value;
          delete entry.wordTimings;
        })
      }
    />
  ) : (
    <Textarea
      size="sm"
      label={words.prompt}
      hint={S.activities.sound.promptHint}
      maxLength={SOUND_PROMPT_MAX}
      className="min-h-36"
      value={prompt}
      disabled={locked}
      onChange={(event) =>
        onEdit((entry) => {
          entry.script = withSoundPrompt(entry.script, event.target.value);
        })
      }
    />
  );

  const voicePicker = narration && (
    <VoicePicker
      options={providerVoices}
      value={voice || null}
      label={S.activities.voicePicker.label}
      disabled={locked}
      hint={asset.path ? S.activities.voicePicker.appliesNext : undefined}
      onChange={(id) =>
        onEdit((entry) => {
          // The bound clip keeps the voice it was recorded in, and its timings.
          entry.voice = id;
        })
      }
    />
  );

  // A translation or script suggestion for this language, reviewed where the script is.
  const suggestion = text && (
    <section aria-label={S.activities.textCandidates} className="space-y-1">
      {text.status === "running" ? (
        <p className="text-xs text-gray-500">
          {text.mediaText?.translation ? words.translating : S.activities.speechStatus[text.status]}
        </p>
      ) : (
        <MediaTextReview
          key={text.runId}
          endpoint={`${endpoint}/runs/${encodeURIComponent(text.runId)}/candidate`}
          target={text.mediaText!}
          currentText={asset.script ?? ""}
          stale={text.inputRevision !== revision}
          editable={editable && text.status === "succeeded"}
          canAccept={canAccept && text.inputRevision === revision}
          onAccept={() => onAcceptText(text.runId)}
        />
      )}
    </section>
  );

  return (
    <section
      aria-label={words.card(name)}
      className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* What Save does is explained beside the language it saves for. */}
        <h3 className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold">
          {name}
          {editable && <InfoPopover label={words.card(name)}>{words.saveAbout}</InfoPopover>}
        </h3>
        {editable && (
          <>
            {primary.action === "translate" ? (
              <Button
                size="sm"
                variant="primary"
                disabled={!canGenerate || !onTranslate || text?.status === "running"}
                onClick={() => onTranslate?.(language, asset.key)}
              >
                {text?.status === "running" ? words.translating : words.translate(defaultName)}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={primary.action === "blocked" || (narration ? !canSpeak : !canSound)}
                onClick={generate}
              >
                {generating
                  ? words.generating
                  : primary.action === "generate" && primary.again
                    ? words.regenerate
                    : words.generate}
              </Button>
            )}
            <Button
              size="sm"
              disabled={
                !candidate ||
                accepting ||
                disabled ||
                (candidate.source === "generated" && !canAccept)
              }
              onClick={() => void save()}
            >
              {accepting ? words.saving : words.save}
            </Button>
            <label
              className={`relative inline-flex items-center ${labelButtonClass("secondary", "sm")}`}
            >
              <HiddenFileInput
                accept={UPLOAD_ACCEPT.audio}
                disabled={locked || uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
              {uploading ? words.uploading : words.upload}
            </label>
          </>
        )}
      </div>
      {editable && primary.action === "blocked" && (
        <p className="text-xs text-gray-500">{words.needsSource(defaultName)}</p>
      )}
      {(error || runError) && (
        <p role="alert" className={`break-words text-xs ${toneInk.danger}`}>
          {error || runError}
        </p>
      )}
      {narration && providerProblem && (
        <p className={`text-xs ${toneInk.attention}`}>{providerProblem}</p>
      )}
      {narration && provider === "elevenlabs" && !voice && editable && (
        <p className={`text-xs ${toneInk.attention}`}>{S.activities.speechProvider.noVoice}</p>
      )}
      {!narration && !soundProviders && editable && (
        <p className="text-xs text-gray-500">{S.activities.sound.noProvider}</p>
      )}
      {!narration && soundProvider?.problem && (
        <p className={`text-xs ${toneInk.attention}`}>{soundProvider.problem}</p>
      )}
      {advanced ? (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-44 flex-1">
              <AudioPlaybackFields
                asset={asset}
                disabled={locked}
                onChange={(playback) =>
                  onEdit((entry) => {
                    // Music and effects are not spoken, so they name no voice or speaker.
                    if (playback) {
                      delete entry.voice;
                      delete entry.speechProvider;
                      delete entry.speechModel;
                    }
                    delete entry.kind;
                    delete entry.channel;
                    delete entry.loop;
                    delete entry.volume;
                    if (playback) Object.assign(entry, playback);
                    // Only music and effects ask for a length.
                    else delete entry.targetDurationMs;
                  })
                }
              />
            </div>
            {narration ? (
              <>
                <div className="min-w-44 flex-1">
                  <Select
                    size="sm"
                    label={S.activities.speechProvider.label}
                    hint={provider === "kokoro" ? S.activities.speechProvider.localInfo : undefined}
                    value={provider}
                    disabled={locked}
                    onChange={(event) =>
                      onEdit((entry) =>
                        setProvider(
                          entry,
                          event.target.value as SpeechProviderId,
                          voices,
                          language,
                        ),
                      )
                    }
                  >
                    {SPEECH_PROVIDERS.map((id) => {
                      const supported = supportsSpeechLanguage(voices, id, language);
                      const status = providerStatus(speechProviders, id);
                      const label = S.activities.speechProvider[id];
                      return (
                        <option
                          key={id}
                          value={id}
                          disabled={
                            !supported || (!!status && !status.available && id !== provider)
                          }
                        >
                          {!supported
                            ? `${label} (${S.activities.speechProvider.languageUnsupported})`
                            : status && !status.available
                              ? `${label} (${status.problem === "runtime_missing" ? S.activities.speechProvider.runtimeMissing : S.activities.speechProvider.keyMissing(status.credential)})`
                              : label}
                        </option>
                      );
                    })}
                  </Select>
                </div>
                {provider === "elevenlabs" && (
                  <div className="min-w-44 flex-1">
                    <Select
                      size="sm"
                      label={words.model}
                      value={speechModelOf(asset)}
                      disabled={locked}
                      onChange={(event) =>
                        onEdit((entry) => {
                          const model = event.target.value as ElevenLabsModel;
                          // The default is left unsaved, so the manifest names only a choice.
                          if (model === ELEVENLABS_DEFAULT_MODEL) delete entry.speechModel;
                          else entry.speechModel = model;
                        })
                      }
                    >
                      {ELEVENLABS_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {words.models[model]}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="min-w-56 flex-[2]">{voicePicker}</div>
              </>
            ) : (
              <>
                {soundOptions.length > 0 && soundProvider && (
                  <div className="min-w-44 flex-1">
                    <Select
                      size="sm"
                      label={S.activities.sound.provider}
                      hint={
                        soundMaxSeconds(soundProvider.id) < 60
                          ? S.activities.sound.localInfo
                          : undefined
                      }
                      value={soundProvider.id}
                      disabled={locked}
                      onChange={(event) => setSoundChoice(event.target.value)}
                    >
                      {soundOptions.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          disabled={option.problem !== null}
                        >
                          {option.problem
                            ? S.activities.sound.unavailable(option.label, option.problem)
                            : option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {soundProvider && soundProvider.models.length > 1 && (
                  <div className="min-w-44 flex-1">
                    <Select
                      size="sm"
                      label={S.activities.sound.model}
                      value={soundModel?.id ?? ""}
                      disabled={locked}
                      onChange={(event) => setSoundModelChoice(event.target.value)}
                    >
                      {soundProvider.models.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          disabled={option.problem !== null}
                        >
                          {option.problem
                            ? S.activities.sound.unavailable(option.id, option.problem)
                            : option.id}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="w-40">
                  <Input
                    size="sm"
                    type="number"
                    min={1}
                    max={maxSeconds}
                    step={0.5}
                    label={S.activities.sound.length}
                    hint={S.activities.sound.lengthHint(maxSeconds, maxSeconds < 60)}
                    error={validLength ? undefined : S.activities.sound.lengthInvalid(maxSeconds)}
                    value={lengthValue}
                    disabled={locked}
                    onChange={(event) => {
                      const typed = event.target.value;
                      setLengthDraft(typed);
                      const parsed = parseLength(typed);
                      if (parsed.ok)
                        onEdit((entry) => {
                          if (parsed.ms === undefined) delete entry.targetDurationMs;
                          else entry.targetDurationMs = parsed.ms;
                        });
                    }}
                  />
                </div>
              </>
            )}
          </div>
          {narration && provider === "elevenlabs" && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Input
                  size="sm"
                  label={S.activities.speechProvider.voiceId}
                  hint={S.activities.speechProvider.voiceIdHint}
                  value={typedVoice}
                  disabled={locked}
                  spellCheck={false}
                  onChange={(event) => setTypedVoice(event.target.value.trim())}
                />
              </div>
              <Button
                size="sm"
                disabled={locked || !isElevenLabsVoiceId(typedVoice)}
                onClick={() => {
                  onEdit((entry) => {
                    entry.voice = typedVoice;
                  });
                  setTypedVoice("");
                }}
              >
                {S.activities.speechProvider.useVoiceId}
              </Button>
              {voiceLibrary && onReloadVoices && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || voiceLibrary.loading}
                  onClick={onReloadVoices}
                >
                  {voiceLibrary.loading
                    ? S.activities.speechProvider.loadingVoices
                    : S.activities.speechProvider.reloadVoices}
                </Button>
              )}
              {voiceLibrary?.problem && (
                <p className={`basis-full text-xs ${toneInk.attention}`}>
                  {S.activities.speechProvider.libraryProblem[voiceLibrary.problem]}
                </p>
              )}
            </div>
          )}
          {!narration && language !== defaultLanguage && (
            <p className="text-xs text-gray-500">{words.sharedSound}</p>
          )}
          {scriptField}
          {suggestion}
          <div className="@container">
            <div className="grid gap-4 @2xl:grid-cols-2">
              <section aria-label={words.current} className="min-w-0 space-y-2">
                <h4 className="text-xs font-medium">{words.current}</h4>
                {current(words.current)}
              </section>
              <section aria-label={words.candidate} className="min-w-0 space-y-2">
                <h4 className="text-xs font-medium">
                  {candidate ? candidateLabel(candidate) : words.candidate}
                </h4>
                {candidate ? (
                  candidateView(candidate)
                ) : (
                  <p className="text-xs text-gray-500">{words.noCandidate}</p>
                )}
              </section>
            </div>
          </div>
          {narration && asset.generatedAudio && (
            <WordTimingsView timings={asset.wordTimings} seconds={playhead} />
          )}
          {narration && editable && (
            <Button
              size="sm"
              disabled={!canGenerate}
              onClick={() => onGenerateText(language, asset.key)}
            >
              {S.activities.improveNarration}
            </Button>
          )}
          <section aria-label={words.binding} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="min-w-0 flex-1 text-xs font-medium">{words.binding}</h4>
              {asset.path?.startsWith("media/") && (
                <a
                  href={sandboxMediaUrl(endpoint, asset.path)}
                  download={asset.path.split("/").pop()}
                  className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-300"
                >
                  {S.activities.downloadCurrent}
                </a>
              )}
            </div>
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
              onUploaded={(stored) =>
                setPending({ source: "upload", path: stored.path, name: stored.name })
              }
              onChange={(path) =>
                onEdit((entry) => {
                  if (path) entry.path = path;
                  else delete entry.path;
                  // Timings describe the recording that was bound, not this one.
                  delete entry.wordTimings;
                  delete entry.durationMs;
                  delete entry.phonemeTimings;
                  delete entry.wholeWordTiming;
                })
              }
            />
            <p className="text-xs text-gray-500">{words.olderTakes}</p>
          </section>
        </>
      ) : (
        <div className="@container">
          <div className="grid gap-4 @2xl:grid-cols-2">
            <div className="min-w-0 space-y-3">
              {voicePicker}
              {scriptField}
              {suggestion}
            </div>
            <section
              aria-label={candidate ? candidateLabel(candidate) : words.current}
              className="min-w-0 space-y-2"
            >
              <h4 className="text-xs font-medium">
                {candidate ? candidateLabel(candidate) : words.current}
              </h4>
              {candidate ? candidateView(candidate) : current(words.current)}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
