/**
 * The models page's two catalog actions, both run by the server against the saved table
 * (`POST …/models/sync-presets`): "Add new models" (`add`) puts in the presets the table lacks
 * and touches nothing else; "Restore defaults" (`restore`) puts every built-in model back to the
 * catalog, keeping keys and the user's own models, behind a danger confirmation.
 *
 * Both run only from their confirmation, each bound to its mode here through runPresetSync, so
 * which control sends which mode lives in one place: "Add new models" (the header button and the
 * Models notice) opens a confirmation listing what would be added; "Restore defaults" opens a
 * danger one saying what it resets and keeps. The controls hold no state of their own: the page
 * owns the busy flags and the table, and hands them in as a {@link PresetSyncHost}.
 */
import type { ModelsResponse, PresetSyncMode } from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, toastError, toastInfo, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";

/** What a catalog action needs from the page. */
export interface PresetSyncHost {
  projectId: string;
  /** Takes in the table the server answered with, whole. */
  adopt: (res: ModelsResponse) => void;
  /** The page's busy flag, held for the length of the request. */
  setBusy: (busy: boolean) => void;
  /**
   * Re-probes the Models badge. It is gated on the SAVED table, so the dot goes down on the
   * server's answer rather than on the assumption that the write covered everything — and, after
   * a "no new presets" answer, a badge left raised by a stale probe goes too.
   */
  refreshTodos: () => void;
}

/**
 * Runs one catalog action and reports it in a toast: the restored and added counts, the added
 * count, or "nothing new". Resolves once the request settles, success or not, so a confirmation
 * can hold its busy state until then.
 */
export async function runPresetSync(host: PresetSyncHost, mode: PresetSyncMode): Promise<void> {
  host.setBusy(true);
  try {
    const res = await api.syncPresets(host.projectId, { mode });
    host.adopt(res);
    if (mode === "restore") toastSuccess(S.models.restoredDefaults(res.added, res.restored));
    else if (res.added > 0) toastSuccess(S.models.presetsAdded(res.added));
    else toastInfo(S.models.presetsNone);
  } catch (e) {
    toastError(apiErrorText(e));
  } finally {
    host.setBusy(false);
    host.refreshTodos();
  }
}

/**
 * "Add new models" in the page header. It appears only while new presets are actually waiting
 * (the caller's gate), and the accent says so. It opens the add confirmation (`onOpen`) rather
 * than writing: every sync entry confirms first. `note` is what the Models trail says is waiting;
 * it rides in the title and in an sr-only tail of the name.
 */
export function AddNewModelsButton({
  onOpen,
  disabled,
  note,
}: {
  onOpen: () => void;
  disabled: boolean;
  note: string;
}) {
  return (
    <Button
      size="sm"
      variant="primary"
      onClick={onOpen}
      disabled={disabled}
      title={`${S.models.syncNewPresetsHint} · ${note}`}
    >
      {S.models.syncNewPresets}
      <span className="sr-only"> · {note}</span>
    </Button>
  );
}

/**
 * The "Add new models" confirmation, opened from the header button and from the Models notice:
 * what an add does and leaves alone, over the list of exactly the models it would add (`items`,
 * the refs the badge's delta named). Confirming runs the add and closes once the request settles.
 */
export function AddNewModelsConfirm({
  host,
  title,
  items,
  busy,
  setSyncing,
  onClose,
}: {
  host: PresetSyncHost;
  title: string;
  items: readonly string[];
  /** A catalog action is in flight: the confirm button spins and the dialog stays. */
  busy: boolean;
  setSyncing: (syncing: boolean) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmModal
      open
      title={title}
      tone="primary"
      confirmLabel={S.models.syncNewPresets}
      cancelLabel={S.common.cancel}
      busy={busy}
      onClose={onClose}
      onConfirm={() => {
        setSyncing(true);
        void runPresetSync(host, "add").finally(() => {
          setSyncing(false);
          onClose();
        });
      }}
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.models.syncNewPresetsHint}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.todo.willTouch}</p>
        <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {items.map((ref) => (
            <li key={ref} className="px-3 py-1.5 font-mono text-xs">
              {ref}
            </li>
          ))}
        </ul>
      </div>
    </ConfirmModal>
  );
}

/**
 * The "Restore defaults" confirmation. It rewrites every built-in model, so the body says, item
 * by item, what goes back to the catalog and what is kept, and that it is final; confirming runs
 * the restore and closes once the request settles.
 */
export function RestoreDefaultsConfirm({
  host,
  busy,
  setSyncing,
  onClose,
}: {
  host: PresetSyncHost;
  /** A catalog action is in flight: the confirm button spins and the dialog stays. */
  busy: boolean;
  setSyncing: (syncing: boolean) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmModal
      open
      title={S.models.restoreDefaultsTitle}
      tone="danger"
      confirmLabel={S.models.restoreDefaults}
      cancelLabel={S.common.cancel}
      busy={busy}
      onClose={onClose}
      onConfirm={() => {
        setSyncing(true);
        void runPresetSync(host, "restore").finally(() => {
          setSyncing(false);
          onClose();
        });
      }}
    >
      <RestoreDefaultsBody />
    </ConfirmModal>
  );
}

/**
 * The body of the "Restore defaults" confirmation: what goes back to the catalog, what is kept,
 * and that it is final — in that order, one paragraph each, so the reader can check the one
 * thing they care about (their keys, their own models) without parsing a sentence.
 */
export function RestoreDefaultsBody() {
  return (
    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
      <p>{S.models.restoreDefaultsResets}</p>
      <p>{S.models.restoreDefaultsKeeps}</p>
      <p>{S.models.restoreDefaultsFinal}</p>
    </div>
  );
}
