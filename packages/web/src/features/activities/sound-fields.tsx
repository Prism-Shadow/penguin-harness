/**
 * A music or sound-effect asset's generation fields: the prompt it is made from (its script),
 * the length to ask for, the provider, and Generate. A provider that cannot make the sound
 * stays listed, disabled, with the reason worded.
 */
import { useState } from "react";
import type { MediaAsset, SoundProviderStatus } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  SOUND_PROMPT_MAX,
  canGenerateSound,
  chosenModel,
  chosenProvider,
  lengthText,
  parseLength,
  providerOptions,
  soundPromptOf,
  withSoundPrompt,
} from "./sound-model";

export function SoundFields({
  asset,
  editable,
  disabled,
  canGenerate,
  generating,
  providers,
  onEdit,
  onGenerate,
}: {
  asset: MediaAsset & { kind: NonNullable<MediaAsset["kind"]> };
  editable: boolean;
  disabled: boolean;
  /** Whether a run may start now (a Penguin agent, a saved draft, nothing running). */
  canGenerate: boolean;
  /** Whether a sound run for this asset is under way. */
  generating: boolean;
  /** The providers the chosen agent can use; null while unknown or without a Penguin agent. */
  providers: readonly SoundProviderStatus[] | null;
  onEdit: (change: (entry: MediaAsset) => void) => void;
  /** `model` is set for a provider with a choice of models. */
  onGenerate: (provider: string, model?: string) => void;
}) {
  const words = S.activities.sound;
  const [choice, setChoice] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  // The Length field's text while it does not hold a length that can be saved.
  const [lengthDraft, setLengthDraft] = useState<{ key: string; text: string } | null>(null);
  const prompt = soundPromptOf(asset.script);
  const lengthValue =
    lengthDraft?.key === asset.key ? lengthDraft.text : lengthText(asset.targetDurationMs);
  const length = parseLength(lengthValue);
  const options = providerOptions(providers ?? [], asset.kind);
  const provider = chosenProvider(options, choice);
  const model = chosenModel(provider, modelChoice);
  const locked = !editable || disabled;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{S.activities.audioPlayback.notSpoken}</p>
      <Textarea
        size="sm"
        label={words.prompt}
        hint={words.promptHint}
        rows={3}
        maxLength={SOUND_PROMPT_MAX}
        value={prompt}
        disabled={locked}
        onChange={(event) =>
          onEdit((entry) => {
            entry.script = withSoundPrompt(entry.script, event.target.value);
          })
        }
      />
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-40">
          <Input
            size="sm"
            type="number"
            min={1}
            max={provider?.id === "musicgen" ? 30 : 60}
            step={0.5}
            label={words.length}
            hint={words.lengthHint}
            error={length.ok ? undefined : words.lengthInvalid}
            value={lengthValue}
            disabled={locked}
            onChange={(event) => {
              const text = event.target.value;
              setLengthDraft({ key: asset.key, text });
              const parsed = parseLength(text);
              if (parsed.ok)
                onEdit((entry) => {
                  if (parsed.ms === undefined) delete entry.targetDurationMs;
                  else entry.targetDurationMs = parsed.ms;
                });
            }}
          />
        </div>
        {options.length > 0 && provider && (
          <div className="min-w-48 flex-1">
            <Select
              size="sm"
              label={words.provider}
              hint={provider.id === "musicgen" ? words.localInfo : undefined}
              value={provider.id}
              disabled={locked}
              onChange={(event) => setChoice(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id} disabled={option.problem !== null}>
                  {option.problem ? words.unavailable(option.label, option.problem) : option.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {provider && provider.models.length > 1 && (
          <div className="min-w-48 flex-1">
            <Select
              size="sm"
              label={words.model}
              value={model?.id ?? ""}
              disabled={locked}
              onChange={(event) => setModelChoice(event.target.value)}
            >
              {provider.models.map((option) => (
                <option key={option.id} value={option.id} disabled={option.problem !== null}>
                  {option.problem ? words.unavailable(option.id, option.problem) : option.id}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {!providers && editable && <p className="text-xs text-gray-500">{words.noProvider}</p>}
      {provider?.problem && <p className={`text-xs ${toneInk.attention}`}>{provider.problem}</p>}
      {editable && (
        <Button
          size="sm"
          disabled={
            !canGenerate ||
            generating ||
            !canGenerateSound(prompt, provider, length.ok) ||
            (provider?.id === "musicgen" && (asset.targetDurationMs ?? 10000) > 30000)
          }
          onClick={() =>
            provider &&
            onGenerate(provider.id, provider.models.length && model ? model.id : undefined)
          }
        >
          {generating ? words.generating : asset.generatedAudio ? words.regenerate : words.generate}
        </Button>
      )}
    </div>
  );
}
