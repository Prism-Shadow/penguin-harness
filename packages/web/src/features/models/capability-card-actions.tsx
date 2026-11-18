import type { Capability, CapabilitySettings, ModelRefDto } from "@prismshadow/penguin-server/api";
import { Button, GlyphIcon, ICONS } from "@prismshadow/penguin-ui";
import { capabilities } from "../../api/project-capabilities";
import { sameModelRef } from "../../lib/model-grouping";
import { S } from "../../lib/strings";

export function CapabilityCardActions({
  model,
  settings,
  owner,
  busy,
  onSelect,
}: {
  model: ModelRefDto;
  settings: CapabilitySettings | null;
  owner: boolean;
  busy: boolean;
  onSelect: (key: Capability, model: ModelRefDto) => void;
}) {
  if (!settings) return null;
  const choices = capabilities.filter(
    (key) =>
      settings.candidates[key].some((candidate) => sameModelRef(candidate, model)) &&
      (owner || sameModelRef(settings.bindings[key], model)),
  );
  if (!choices.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line-muted px-3 py-2">
      {choices.map((key) => {
        const selected = sameModelRef(settings.bindings[key], model);
        const label = selected ? S.voice.currentFor[key] : S.voice.assignFor[key];
        if (!owner)
          return (
            <span
              key={key}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent"
            >
              <GlyphIcon d={ICONS.check} size={14} />
              {label}
            </span>
          );
        return (
          <Button
            key={key}
            size="xs"
            variant={selected ? "ghost" : "secondary"}
            className={selected ? "bg-accent-tint text-accent" : undefined}
            aria-pressed={selected}
            aria-disabled={selected || busy}
            onClick={() => {
              if (!selected && !busy) onSelect(key, model);
            }}
          >
            {selected && <GlyphIcon d={ICONS.check} size={14} />}
            {label}
          </Button>
        );
      })}
    </div>
  );
}
