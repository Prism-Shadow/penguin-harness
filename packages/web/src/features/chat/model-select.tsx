/**
 * The model picker's trigger, extracted from chat-input.tsx so every host offers the same
 * picker: ModelSelect (provider logo + name + chevron), pill or form style. Either opens the
 * model-picker dialog (model-picker-modal.tsx), which the in-session `/model` switch opens too.
 * The composer's other switch picker, the `/agent` handoff, is the UI package's PickerList.
 */
import { useState } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { ChevronDown, ICON_SIZE, ProviderLogo } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { FormPickerTrigger } from "../../components/ui/form-picker";
import { sameModelRef } from "../models/model-grouping";
import { modelLabel } from "./model-picker-logic";
import { ModelPickerModal } from "./model-picker-modal";

// Re-exported for the pages that label models (the models page, the Project and company
// dialogs); it lives beside the picker's pure logic so the dialog can share it without an
// import cycle back to this module.
export { modelLabel };

/**
 * Model selector (the chat composer's bottom-toolbar trigger, also hosted by the Project
 * settings' new-chat-defaults section, the schedule form, the company dialogs and the benchmark
 * dialog): the button shows the provider logo + name and opens the model-picker dialog (search,
 * provider-group rail, key-configured-first listing, Free badge — documented there). A pick
 * closes the dialog and reports `{ provider, modelId }` through `onChange`.
 *
 * Two trigger variants, one dialog:
 * - "pill" (default): the composer's compact toolbar button — collapses to the logo alone
 *   under the card's own `@container` query;
 * - "form": the shared form trigger (full-width, Input/Select-styled), used by every dialog
 *   host. The picker opened from inside a dialog stacks above it as a second Modal, and Escape
 *   closes only the picker.
 *
 * `emptyLabel` is for the one kind of host where an unpicked model is a decision and not a
 * gap — the organization dialogs' "Project default"; see the prop.
 */
export function ModelSelect({
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
  /** Trigger style: the composer's toolbar pill (default), or a dialog form control (see the header comment). */
  variant?: "pill" | "form";
  /**
   * What the trigger reads while nothing is picked, for a host where "nothing" is itself a
   * choice rather than an unfinished one — the organization dialogs, where an empty model
   * means "follow the Project's default". The picker still offers models only, so such a host
   * carries its own way back to the empty value; here the label is grayed as a placeholder
   * and the provider logo is dropped, since no provider is being named.
   */
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => sameModelRef(m, value));
  const unset = value === null && emptyLabel !== undefined;
  // Display rule matches the model page's card: display name, or falls back to the upstream id (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? emptyLabel ?? "…");
  const logo = unset ? null : (
    <ProviderLogo
      provider={current?.provider ?? value?.provider ?? "custom"}
      className="h-4 w-4 shrink-0"
    />
  );
  const isDisabled = disabled || models.length === 0;
  const picker = (
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
  );
  // Form: the shared full-width trigger (same look as Input/Select), used by every dialog picker.
  if (variant === "form") {
    return (
      <>
        <FormPickerTrigger
          size="sm"
          expanded={open}
          onClick={() => setOpen(true)}
          leading={logo}
          label={label}
          muted={unset}
          title={`${S.chat.chooseModel}：${label}`}
          ariaLabel={S.chat.chooseModel}
          ariaHaspopup="dialog"
          disabled={isDisabled}
        />
        {picker}
      </>
    );
  }
  // Pill: the composer's compact toolbar button.
  return (
    <>
      <button
        type="button"
        data-tooltip={`${S.chat.chooseModel}：${label}`}
        aria-label={S.chat.chooseModel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={isDisabled}
        onClick={() => setOpen(true)}
        className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        {logo}
        {/* When the card is narrower than @md, only the provider logo remains (title shows the full name). */}
        <span className="hidden min-w-0 truncate @md:block">{label}</span>
        <ChevronDown size={ICON_SIZE.caretDense} />
      </button>
      {picker}
    </>
  );
}
