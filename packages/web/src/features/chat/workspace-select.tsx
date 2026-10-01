/**
 * Workspace picker triggers: which directory, and — when machines can be chosen — which
 * MACHINE it is on. A workspace is a directory on a machine, so choosing one is choosing where
 * the path has to exist; the finder lists that machine's filesystem, over ssh when it is not
 * this one.
 *
 * Three trigger shapes open the same Finder-style modal (workspace-finder.tsx):
 * - "pill" (default): the draft page's compact toolbar pill;
 * - "form": the shared form-control trigger (FormPickerTrigger), for dialogs — the finder is a
 *   Modal of its own and stacks above the host dialog;
 * - `trigger`: a caller-rendered button (the sidebar's new-workspace header button).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Chevron, FormPickerTrigger, GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { WorkspaceFinder } from "./workspace-finder";
import { baseName } from "./workspace-finder-model";

/** Shared style for pill trigger buttons (ChatGPT project button style: small rounded pill + icon + short name + collapse arrow). */
export const pillClass =
  "flex max-w-64 items-center gap-1.5 rounded-full border border-gray-300 bg-white py-1 pl-1.5 pr-2 " +
  "text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/**
 * Workspace selection: the trigger shows the selected directory's name (empty = a temporary
 * workspace, or the host's `emptyLabel`) and opens the finder. Callers get `onChange(path,
 * machineId)` on Choose, and `onChange("", machineId)` from the finder's no-folder button.
 */
export function WorkspaceSelect({
  projectId,
  workspace,
  onChange,
  machineId,
  chooseMachine,
  agentId,
  variant = "pill",
  trigger,
  fieldLabel,
  emptyLabel,
  clearLabel,
  clearable = true,
}: {
  projectId: string;
  workspace: string;
  /** `machineId` is null for this machine — the shape the registry stores. */
  onChange: (path: string, machineId?: string | null) => void;
  /** The machine to browse first; omitted starts on the window's current server. */
  machineId?: string | null;
  /** Offer the Machines section. Off where a machine cannot be meaningfully chosen yet. */
  chooseMachine?: boolean;
  /** The Agent a temporary Workspace would belong to, so the finder can show where it would be created. */
  agentId?: string;
  /** Trigger style: the draft page's pill (default), or a dialog form control (see the header comment). */
  variant?: "pill" | "form";
  /**
   * Caller-rendered trigger (the sidebar's new-workspace header button): replaces the pill. The
   * same finder opens from it.
   */
  trigger?: (open: boolean, toggle: () => void) => ReactNode;
  /**
   * Copy overrides for a host that browses for a directory which is not going to be a Workspace —
   * the Agent create dialog picks one to read Skills out of, where "temporary workspace" would
   * describe something this field does not do. `fieldLabel` names the field itself: it is the
   * accessible name of both triggers and the finder's title, and the label the tooltip puts in
   * front of the picked path, so a host that overrides the visible copy is not left announcing
   * itself as "Workspace".
   */
  fieldLabel?: string;
  emptyLabel?: string;
  /**
   * The finder's no-folder button, for a host whose empty value is not a temporary Workspace
   * (the organization's own directory, or no directory at all): it shows this label alone,
   * since the path it would name and the rule behind it are the temporary Workspace's.
   */
  clearLabel?: string;
  /**
   * Offer that button (the default). Off for the sidebar's new-workspace button, which adds a
   * folder and has no empty value to go back to.
   */
  clearable?: boolean;
}) {
  const fieldName = fieldLabel ?? S.chat.workspace;
  const [open, setOpen] = useState(false);

  const trimmed = workspace.trim();
  // Short name: the last segment of the directory (a root keeps its own spelling); "temporary workspace" when empty.
  const label = trimmed ? baseName(trimmed) : (emptyLabel ?? S.chat.workspaceAuto);
  // The field and its value, the whole path where the label shows only its last segment.
  const title = `${fieldName}：${trimmed || label}`;

  const finder = (
    <WorkspaceFinder
      open={open}
      onClose={() => setOpen(false)}
      onChoose={(path, machine) => {
        onChange(path, machine);
        setOpen(false);
      }}
      onClear={
        clearable
          ? (machine) => {
              onChange("", machine);
              setOpen(false);
            }
          : undefined
      }
      projectId={projectId}
      workspace={workspace}
      machineId={machineId}
      chooseMachine={chooseMachine}
      agentId={agentId}
      title={fieldName}
      clearLabel={clearLabel ?? S.chat.workspaceClear}
      clearTitle={clearLabel === undefined ? S.chat.workspaceTempRule : undefined}
    />
  );

  /** Folder glyph shared by both built-in triggers. */
  const folderIcon = (extraClass: string) => (
    <GlyphIcon
      d={ICONS.folder}
      size={ICON_SIZE.rowLead}
      className={`text-gray-400 ${extraClass}`}
    />
  );

  if (trigger) {
    return (
      <>
        {trigger(open, () => setOpen(!open))}
        {finder}
      </>
    );
  }

  // Form: the shared full-width trigger (its label goes mono once a real path is set).
  if (variant === "form") {
    return (
      <>
        <FormPickerTrigger
          size="sm"
          expanded={open}
          onClick={() => setOpen(!open)}
          leading={folderIcon("")}
          label={label}
          {...(trimmed ? { labelClassName: "font-mono" } : {})}
          title={title}
          ariaLabel={fieldName}
          ariaHaspopup="dialog"
        />
        {finder}
      </>
    );
  }

  // Pill: the composer's compact toolbar trigger.
  return (
    <>
      <button
        type="button"
        data-tooltip={title}
        aria-label={fieldName}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={pillClass}
      >
        {folderIcon("ml-0.5")}
        <span className={`min-w-0 truncate ${trimmed ? "font-mono" : ""}`}>{label}</span>
        <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
      </button>
      {finder}
    </>
  );
}
