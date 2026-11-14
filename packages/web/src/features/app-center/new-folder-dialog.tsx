/**
 * Making a folder from a dialog — the way to one that needs no drag, from the page header, the
 * grid's empty space, or a tile's "Move to…". It holds a name and the apps to put in the folder:
 *
 * - The name starts as "New folder", selected, so typing replaces it.
 * - The list is every app of the grid in its order, each with its icon and name. An app already
 *   in a folder names that folder; picking it takes it out of there.
 * - Create is live once an app is picked and the name, trimmed, is 1 to 40 characters. The one
 *   field means Enter creates. The folder is made at the place of the first picked app
 *   (arrangement.ts `groupApps`).
 * - Closing after a change asks before it is thrown away (the settings commit model).
 *
 * The form is mounted only while the dialog is open, so it always starts afresh, with the app it
 * was opened for already picked when it came from a tile's menu.
 */
import { useRef } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  Button,
  Checkbox,
  FieldLegend,
  ICON_SIZE,
  Input,
  Modal,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { TileIcon } from "./app-tile";
import type { GridApp, GridFolder, GridItem } from "./arrangement";
import { FOLDER_NAME_MAX } from "./folder-name-dialog";

interface Draft {
  name: string;
  /** The picked apps' keys. */
  apps: string[];
}

export function NewFolderDialog({
  picked,
  grid,
  titleOf,
  onCreate,
  onClose,
}: {
  /** The apps picked when it opens; null while the dialog is closed. */
  picked: readonly string[] | null;
  grid: readonly GridItem[];
  titleOf: (shortcut: AppCenterShortcut) => string;
  /** Makes the folder: its trimmed name and the picked apps. */
  onCreate: (name: string, apps: string[]) => void;
  onClose: () => void;
}) {
  return picked === null ? null : (
    <NewFolderForm
      picked={picked}
      grid={grid}
      titleOf={titleOf}
      onCreate={onCreate}
      onClose={onClose}
    />
  );
}

function NewFolderForm({
  picked,
  grid,
  titleOf,
  onCreate,
  onClose,
}: {
  picked: readonly string[];
  grid: readonly GridItem[];
  titleOf: (shortcut: AppCenterShortcut) => string;
  onCreate: (name: string, apps: string[]) => void;
  onClose: () => void;
}) {
  const form = useFormDraft<Draft>(
    { name: S.appCenter.newFolder, apps: [...picked] },
    { normalize: (draft) => ({ name: draft.name.trim(), apps: [...draft.apps].sort() }) },
  );
  const requestClose = useGuardedClose(onClose, form.scope);
  /** The starting name is selected once, when the field first takes focus. */
  const unselected = useRef(true);
  const name = form.draft.name.trim();
  const valid = name !== "" && [...name].length <= FOLDER_NAME_MAX && form.draft.apps.length > 0;
  /** Every app in the grid's order, with the folder it sits in. */
  const rows = grid.flatMap<{ app: GridApp; folder: GridFolder | null }>((item) =>
    item.type === "app"
      ? [{ app: item, folder: null }]
      : item.apps.map((app) => ({ app, folder: item })),
  );
  const toggle = (id: string, on: boolean) =>
    form.setDraft((draft) => ({
      ...draft,
      apps: on ? [...draft.apps, id] : draft.apps.filter((app) => app !== id),
    }));
  const submit = () => {
    if (!valid) return;
    onCreate(name, form.draft.apps);
    onClose();
  };
  return (
    <Modal
      open
      title={S.appCenter.newFolderTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!valid} onClick={submit}>
            {S.appCenter.newFolderCreate}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          size="sm"
          label={S.appCenter.folderNameLabel}
          hint={S.appCenter.folderNameHint}
          value={form.draft.name}
          maxLength={FOLDER_NAME_MAX * 2}
          autoFocus
          onFocus={(e) => {
            if (!unselected.current) return;
            unselected.current = false;
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const value = e.target.value;
            form.setDraft((draft) => ({ ...draft, name: value }));
          }}
        />
        <fieldset className="mt-4 min-w-0">
          <FieldLegend>{S.appCenter.newFolderApps}</FieldLegend>
          <ul className="max-h-64 space-y-2 overflow-y-auto py-1">
            {rows.map(({ app, folder }) => {
              const title = titleOf(app.shortcut);
              return (
                <li key={app.id}>
                  <Checkbox
                    checked={form.draft.apps.includes(app.id)}
                    onChange={(on) => toggle(app.id, on)}
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        <TileIcon shortcut={app.shortcut} title={title} size={ICON_SIZE.navRow} />
                        <span className="truncate">{title}</span>
                      </span>
                    }
                    {...(folder !== null
                      ? { hint: S.appCenter.newFolderInFolder(folder.name) }
                      : {})}
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>
      </form>
    </Modal>
  );
}
