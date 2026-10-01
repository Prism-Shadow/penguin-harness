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
import { sameModelRef } from "../models/model-grouping";
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
 * `emptyLabel` is for the one kind of host where an unpicked model is a decision and not a
 * gap — the organization dialogs, where an empty model means "follow the Project's default".
 * The picker still offers models only, so such a host carries its own way back to the empty
 * value; here the label is grayed as a placeholder and the provider logo is dropped, since no
 * provider is being named.
 */
export function ModelCatalogSelect({
  models,
  value,
  defaultModel,
  onChange,
  disabled,
  variant = "pill",
  emptyLabel,
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
}) {
  const [open, setOpen] = useState(false);
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
        ariaLabel={S.chat.chooseModel}
        tooltip={`${S.chat.chooseModel}：${label}`}
        disabled={disabled || models.length === 0}
        variant={variant}
        expanded={open}
        onClick={() => setOpen(true)}
      />
      <ModelPickerModal
        open={open}
        onClose={() => setOpen(false)}
        title={S.chat.chooseModel}
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
