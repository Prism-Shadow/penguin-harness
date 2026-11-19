/**
 * The Project operations a model serves (the multimodal bindings: speech recognition, image
 * generation, …), as the Model library shows them.
 *
 * - On the card, a quiet mark: one glyph, the tooltip naming the operations this model is the
 *   Project's model for. Nothing at all for a model that serves none.
 * - In the model's dialog, one row per operation the model can serve: the operation's name, then
 *   「设为默认」 / "Set default", or 「已选用」 / "In use" on the operation's current model. What the
 *   action does in full is its tooltip. A member sees only the operations already assigned to it.
 *
 * Both read the binding list generically — which operations exist, their names and which models
 * can serve each come from the server — so an operation a plugin adds gets its row here without a
 * change to this module. Project settings stays the place that lists every operation at once.
 */
import type { ModelRefDto, ToolModelKey, ToolModelSettings } from "@prismshadow/penguin-server/api";
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
import { sameModelRef } from "../../lib/model-grouping";
import { S } from "../../lib/strings";

export interface ModelOperation {
  key: ToolModelKey;
  /** The operation's name in the interface language. */
  title: string;
  /** This model is the Project's model for the operation. */
  current: boolean;
}

/**
 * The operations this model can serve, in the server's order, each marked when the model is the
 * one the Project uses for it. An operation no active plugin contributes is not listed, and
 * neither is one whose candidates do not include this model.
 */
export function modelOperations(
  settings: ToolModelSettings | null | undefined,
  model: ModelRefDto,
  locale: "zh" | "en",
): ModelOperation[] {
  if (!settings) return [];
  return settings.available
    .filter(({ key }) => settings.candidates[key]?.some((m) => sameModelRef(m, model)))
    .map(({ key, title }) => ({
      key,
      title: title[locale],
      current: sameModelRef(settings.bindings[key], model),
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
  disabled,
  onUse,
}: {
  operations: readonly ModelOperation[];
  canEdit: boolean;
  /** The draft holds unsaved edits, or a write is in flight: the actions wait. */
  disabled: boolean;
  onUse: (key: ToolModelKey) => void;
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
                title={S.voice.setDefaultHint(op.title)}
                disabled={disabled}
                onClick={() => onUse(op.key)}
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
