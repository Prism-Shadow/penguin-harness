/**
 * One word pronunciation of a decodable book, in the asset editor: its word, and its sounds as
 * a row of small boxes the author can correct, add to and remove from. Saving makes the word
 * the author's, so refreshing the book's words never replaces it.
 */
import { useState } from "react";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input } from "../../components/ui/input";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { cleanSounds, sameSounds, soundsProblem } from "./book-words";

type MediaAsset = AssetManifest["assets"][string][number];

const REMOVE = "M6 6l12 12M18 6L6 18";

export function BookWordFields({
  asset,
  editable,
  canSave,
  onSave,
}: {
  asset: MediaAsset;
  editable: boolean;
  /** Whether a save can go now: nothing else running and no unsaved edits it would drop. */
  canSave: boolean;
  onSave: (phonemes: string[]) => void;
}) {
  const saved = asset.phonemes ?? [];
  const [segments, setSegments] = useState<string[]>(() => (saved.length ? [...saved] : [""]));
  const words = S.activities.bookWords;
  const cleaned = cleanSounds(segments);
  const problem = soundsProblem(segments);
  const changed = !sameSounds(cleaned, saved);
  return (
    <section className="space-y-3" aria-label={words.group}>
      <Input size="sm" label={words.word} value={asset.word ?? ""} readOnly />
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">{words.sounds}</legend>
        <p className="text-xs text-gray-500">{words.soundsHint}</p>
        <div className="flex flex-wrap items-end gap-2">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center gap-1">
              <div className="w-16">
                <Input
                  size="sm"
                  aria-label={words.sound(index + 1)}
                  value={segment}
                  maxLength={16}
                  spellCheck={false}
                  disabled={!editable}
                  onChange={(event) =>
                    setSegments((current) =>
                      current.map((value, at) => (at === index ? event.target.value : value)),
                    )
                  }
                />
              </div>
              {editable && segments.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={words.removeSound(index + 1)}
                  onClick={() =>
                    setSegments((current) => current.filter((_value, at) => at !== index))
                  }
                >
                  <GlyphIcon d={REMOVE} size={ICON_SIZE.iconButton} />
                </Button>
              )}
            </div>
          ))}
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              disabled={segments.length >= 32}
              onClick={() => setSegments((current) => [...current, ""])}
            >
              {words.addSound}
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {asset.phonemeSource && saved.length ? words.source[asset.phonemeSource] : words.noSounds}
        </p>
        {changed && problem && problem !== "empty" && (
          <p className={`text-xs ${toneInk.attention}`}>{words.soundsHint}</p>
        )}
      </fieldset>
      {editable && (
        <Button
          size="sm"
          disabled={!canSave || !changed || problem !== null}
          onClick={() => onSave(cleaned)}
        >
          {words.saveSounds}
        </Button>
      )}
    </section>
  );
}
