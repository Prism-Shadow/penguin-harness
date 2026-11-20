/**
 * The model picker bound to the Project's model catalog: the UI package's `ModelSelect` draws the
 * trigger (provider logo + name), as the composer's toolbar pill or a dialog's form field, and
 * either opens the model-picker dialog (model-picker-modal.tsx), which the in-session `/model`
 * switch opens too. The chat composer, the Project settings' new-chat defaults, the schedule
 * form, the organization dialogs and the benchmark dialog all pick a model through it. The
 * composer's other switch picker, the `/agent` handoff, is the UI package's PickerList.
 */
import { useState } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { ModelSelect } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { sameModelRef, visibleChatModels } from "../../lib/model-grouping";
import { modelLabel } from "./model-picker-logic";
import { ModelPickerModal } from "./model-picker-modal";

// Re-exported for the pages that label models (the models page, the Project and company
// dialogs); it lives beside the picker's pure logic so the dialog can share it without an
// import cycle back to this module.
export { modelLabel };

/**
 * Model selector: the trigger shows the provider logo + name and opens the model-picker dialog
 * (search, provider-group rail, key-configured-first listing, Free badge — documented there). A
 * pick closes the dialog and reports `{ provider, modelId }` through `onChange`.
 *
 * Two trigger variants, one dialog:
 * - "pill" (default): the composer's compact toolbar button — collapses to the logo alone
 *   under the card's own `@container` query;
 * - "form": the shared form trigger (full-width, Input/Select-styled), used by every dialog
 *   host. The picker opened from inside a dialog stacks above it as a second Modal, and Escape
 *   closes only the picker.
 *
 * An optional assignment shows its emptyLabel without a provider logo. A host can supply
 * onClear to let the user remove the assignment from the same picker.
 */
export function ModelCatalogSelect({
  models,
  value,
  defaultModel,
  onChange,
  disabled,
  variant = "pill",
  emptyLabel,
  title = S.chat.chooseModel,
  purpose = "chat",
  onClear,
}: {
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  onChange: (ref: ModelRefDto) => void;
  disabled: boolean;
  /** Trigger style: the composer's toolbar pill (default), or a dialog form control. */
  variant?: "pill" | "form";
  /** What the trigger reads while nothing is picked, where "nothing" is itself a choice. */
  emptyLabel?: string;
  title?: string;
  /** Tool callers supply the candidates for one specific operation. */
  purpose?: "chat" | "tool";
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Something to pick: the list the picker will show once every model is listed.
  const canOpen =
    Boolean(onClear) ||
    visibleChatModels(models, {
      showAll: true,
      query: "",
      selected: value,
      tools: purpose === "tool",
    }).length > 0;
  const current = models.find((m) => sameModelRef(m, value));
  const unset = value === null && emptyLabel !== undefined;
  // Display rule matches the model page's card: display name, or falls back to the upstream id
  // (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? emptyLabel ?? "…");
  return (
    <>
      <ModelSelect
        label={label}
        provider={unset ? null : (current?.provider ?? value?.provider ?? "custom")}
        muted={unset}
        ariaLabel={title}
        tooltip={`${title} · ${label}`}
        disabled={disabled || !canOpen}
        variant={variant}
        expanded={open}
        onClick={() => setOpen(true)}
      />
      <ModelPickerModal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        purpose={purpose}
        {...(onClear
          ? {
              onClear: () => {
                onClear();
                setOpen(false);
              },
            }
          : {})}
        models={models}
        value={value}
        {...(defaultModel !== undefined ? { defaultModel } : {})}
        onPick={(m) => {
          onChange({ provider: m.provider, modelId: m.modelId });
          setOpen(false);
        }}
      />
    </>
  );
}
