/**
 * The Project operations a model serves, as the Model library shows them: image understanding,
 * which is the Project's vision model, and the tool bindings the enabled plugins declare (speech
 * recognition, image generation, …).
 *
 * - On the card, a quiet mark: one glyph, the tooltip naming the bindings this model is the
 *   Project's model for. Nothing at all for a model that serves none. (The vision model keeps its
 *   own tag on the card.)
 * - In the model's dialog, one row per operation the model can serve: the operation's name, then
 *   「设为默认」 / "Set default", or 「已选用」 / "In use" on the operation's current model. What the
 *   action does in full is its tooltip. A member sees only the operations already assigned to it.
 *
 * The bindings are read generically — which exist, their names and which models each accepts
 * come from the server — so a binding a plugin adds gets its row here without a change to this
 * module. Project settings stays the place that lists every operation at once.
 */
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import {
  Button,
  CheckIcon,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  SettingRow,
  SettingsGroup,
} from "@prismshadow/penguin-ui";
import type { ToolBinding } from "../../api/tool-types";
import { sameModelRef } from "../../lib/model-grouping";
import { S } from "../../lib/strings";

/** Image understanding's row: the vision model. No binding key has a colon, so none collides. */
export const VISION_OPERATION = ":vision";

export interface ModelOperation {
  /** A binding's key, or VISION_OPERATION. */
  key: string;
  /** The operation's name in the interface language. */
  title: string;
  /** This model is the Project's model for the operation. */
  current: boolean;
  /** What the action does, in full: its tooltip. */
  hint?: string;
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

/** The dialog's block: one row per operation, its short action or its in-use mark. */
export function ModelOperationsBlock({
  operations,
  canEdit,
  isDisabled,
  onUse,
}: {
  operations: readonly ModelOperation[];
  canEdit: boolean;
  /** The action waits: the draft holds unsaved edits, or a write is in flight. */
  isDisabled: (op: ModelOperation) => boolean;
  onUse: (op: ModelOperation) => void;
}) {
  const rows = canEdit ? operations : operations.filter((op) => op.current);
  if (!rows.length) return null;
  return (
    <SettingsGroup title={S.voice.models}>
      {rows.map((op) => (
        // One box per row, so the group's rules fall between rows and a reader (or a test) can
        // find an operation's row by its key.
        <div key={op.key} data-operation={op.key}>
          <SettingRow title={op.title}>
            {op.current ? (
              <span className={`flex items-center ${ICON_GAP.tight} text-xs text-fg-muted`}>
                <CheckIcon size={ICON_SIZE.inlineGlyph} />
                {S.voice.inUse}
              </span>
            ) : (
              <Button
                size="sm"
                title={op.hint ?? S.voice.setDefaultHint(op.title)}
                disabled={isDisabled(op)}
                onClick={() => onUse(op)}
              >
                {S.voice.setDefault}
              </Button>
            )}
          </SettingRow>
        </div>
      ))}
    </SettingsGroup>
  );
}
