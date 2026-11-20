/**
 * The Project operations a model is in use for, as its Model library card marks them: a quiet
 * glyph whose tooltip names the tool bindings the model is the Project's model for (speech
 * recognition, image generation, …), and nothing at all for a model in use for none. (The vision
 * model keeps its own tag on the card.)
 *
 * Choosing the models is elsewhere: every default at once in the 「默认模型」 dialog, or one
 * model as the default for every multimodal operation it can serve from its dialog
 * (default-models.tsx). The bindings are read generically — which exist, their names and which
 * models each accepts come from the server — so a binding a plugin adds is marked here without a
 * change to this module.
 */
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import type { ToolBinding } from "../../api/tool-types";
import { sameModelRef } from "../../lib/model-grouping";
import { S } from "../../lib/strings";

export interface ModelOperation {
  /** A binding's key. */
  key: string;
  /** The operation's name in the interface language. */
  title: string;
  /** This model is the Project's model for the operation. */
  current: boolean;
}

/**
 * The bindings this model can serve, in the server's order, each marked when the model is the
 * one the Project uses for it. A binding whose candidates do not include the model is left out.
 */
export function modelOperations(
  bindings: readonly ToolBinding[] | null | undefined,
  model: ModelRefDto,
  locale: "zh" | "en",
): ModelOperation[] {
  if (!bindings) return [];
  return bindings
    .filter((binding) => binding.candidates.some((m) => sameModelRef(m, model)))
    .map((binding) => ({
      key: binding.key,
      title: binding.title[locale],
      current: sameModelRef(binding.model, model),
    }));
}

/** The card's mark for the operations a model is in use for; nothing when it is in use for none. */
export function ModelInUseMark({ operations }: { operations: readonly ModelOperation[] }) {
  const names = operations.filter((op) => op.current).map((op) => op.title);
  if (!names.length) return null;
  const label = S.voice.inUseFor(names);
  return (
    <span
      role="img"
      aria-label={label}
      data-tooltip={label}
      data-slot="in-use"
      className="flex shrink-0 self-center text-fg-subtle"
    >
      <GlyphIcon d={ICONS.chip} size={ICON_SIZE.inlineGlyph} />
    </span>
  );
}
