/**
 * The Layout menu in the activity header: the built-in and saved layouts, "Save current
 * as…", "Manage…" and the Alt+number shortcut switch. It owns only the list of layouts; the
 * arrangement itself belongs to the workspace, which is handed the chosen layout to apply.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown, menuItemClass } from "../../components/ui/dropdown";
import { CheckIcon, ChevronDown } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastSuccess } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import {
  BUILT_IN_PRESETS,
  LAYOUTS_KEY,
  allPresets,
  commitPresets,
  currentPresetId,
  deletePreset,
  isTypingTarget,
  readPresets,
  renamePreset,
  savePreset,
  shortcutIndex,
  type LayoutPreset,
  type LayoutState,
  type LayoutStore,
  type PresetError,
  type PresetResult,
  type SavedPreset,
} from "./layout-presets";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-middle";

/** A layout's name as the author sees it, read at render time. */
export function presetName(preset: LayoutPreset): string {
  return preset.builtIn ? S.activities.layouts.builtIn[preset.id] : preset.name;
}

function builtInNames(): string[] {
  return BUILT_IN_PRESETS.map((preset) => S.activities.layouts.builtIn[preset.id]);
}

function errorText(error: PresetError): string {
  const words = S.activities.layouts;
  if (error === "limit") return words.limit;
  if (error === "duplicate") return words.duplicate;
  if (error === "tooLong") return words.tooLong;
  return words.empty;
}

export function LayoutMenu({
  state,
  onApply,
}: {
  /** The arrangement on screen, to mark the layout it matches and to save. */
  state: LayoutState;
  onApply: (preset: LayoutPreset) => void;
}) {
  const words = S.activities.layouts;
  const [store, setStoreState] = useState<LayoutStore>(() => readPresets());
  const [open, setOpen] = useState(false);
  // The name dialog, for a new layout or for renaming a saved one.
  const [naming, setNaming] = useState<
    { mode: "save" } | { mode: "rename"; preset: SavedPreset } | null
  >(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState<SavedPreset | null>(null);

  // False once storage refused a write: from then on this page's copy is the only one.
  const persisted = useRef(true);

  /**
   * Changes the layouts as storage holds them now, so a layout another tab saved is kept.
   * Blocked storage keeps the layouts for this page; there is nothing more to do about it.
   */
  function change(apply: (current: LayoutStore) => LayoutStore | null): boolean {
    const result = commitPresets(store, persisted.current, apply);
    if (!result) return false;
    persisted.current = result.persisted;
    setStoreState(result.store);
    return true;
  }

  // Another tab saved, renamed or deleted a layout, or flipped the shortcuts.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== LAYOUTS_KEY) return;
      if (persisted.current) setStoreState(readPresets());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const presets = allPresets(store);
  const current = currentPresetId(state, presets);

  // The latest list and handler for the shortcut listener, which is installed once.
  const latest = useRef({ presets, onApply });
  latest.current = { presets, onApply };
  useEffect(() => {
    if (!store.shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const index = shortcutIndex(event);
      if (index === null) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      const preset = latest.current.presets[index];
      if (!preset) return;
      event.preventDefault();
      latest.current.onApply(preset);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.shortcuts]);

  function startNaming(next: NonNullable<typeof naming>) {
    setOpen(false);
    setName(next.mode === "rename" ? next.preset.name : "");
    setNameError(null);
    setNaming(next);
  }

  function submitName() {
    if (!naming) return;
    // Checked against the layouts as stored now, so a name another tab took is refused.
    const outcome: { result?: PresetResult } = {};
    change((current) => {
      const result =
        naming.mode === "save"
          ? savePreset(current, name, state, builtInNames())
          : renamePreset(current, naming.preset.id, name, builtInNames());
      outcome.result = result;
      return result.ok ? result.store : null;
    });
    const result = outcome.result;
    if (!result) return;
    if (!result.ok && result.error === "missing") {
      // Another tab deleted the layout being renamed: show the list as it now stands.
      setNaming(null);
      if (persisted.current) setStoreState(readPresets());
      return;
    }
    if (!result.ok) {
      setNameError(errorText(result.error));
      return;
    }
    setNaming(null);
    toastSuccess(
      naming.mode === "save" ? words.saved(result.preset.name) : words.renamed(result.preset.name),
    );
  }

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        portal={{ direction: "down", align: "right" }}
        menuClass="w-72 max-w-[calc(100vw-1.5rem)]"
        button={
          <Button
            size="sm"
            variant="ghost"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {words.menu}
            <ChevronDown className="text-gray-400" />
          </Button>
        }
      >
        <div role="menu" aria-label={words.menu} className="max-h-[60vh] overflow-y-auto py-1">
          {presets.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onApply(preset);
              }}
              className={`${menuItemClass} flex items-center gap-2`}
            >
              <span className="min-w-0 flex-1 truncate">{presetName(preset)}</span>
              {preset.id === current && (
                <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  {words.current}
                </span>
              )}
              {store.shortcuts && index < 9 && (
                <kbd className="shrink-0 font-mono text-xs text-gray-400">
                  {words.shortcutKey(index + 1)}
                </kbd>
              )}
            </button>
          ))}
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => startNaming({ mode: "save" })}
            className={menuItemClass}
          >
            {words.saveAs}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setManaging(true);
            }}
            className={menuItemClass}
          >
            {words.manage}
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={store.shortcuts}
            onClick={() => change((current) => ({ ...current, shortcuts: !store.shortcuts }))}
            className={`${menuItemClass} flex items-start gap-2`}
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {store.shortcuts && <CheckIcon />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">{words.shortcuts}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {words.shortcutsHint}
              </span>
            </span>
          </button>
        </div>
      </Dropdown>
      <Modal
        open={naming !== null}
        title={naming?.mode === "rename" ? words.renameTitle(naming.preset.name) : words.saveTitle}
        onClose={() => setNaming(null)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={submitName}>
              {naming?.mode === "rename" ? words.rename : words.save}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          autoFocus
          label={words.name}
          hint={words.nameHint}
          value={name}
          maxLength={80}
          error={nameError ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitName();
            }
          }}
        />
      </Modal>
      <Modal
        open={managing && naming === null && deleting === null}
        title={words.manageTitle}
        onClose={() => setManaging(false)}
        widthClass="sm:max-w-lg"
      >
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEAD}>
                <th className={TH}>{words.nameColumn}</th>
                <th className={TH}>{words.kindColumn}</th>
                <th className={TH}>
                  <span className="sr-only">{words.actionsColumn}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {presets.map((preset) => (
                <tr key={preset.id}>
                  <td className={`${TD} max-w-[16rem] truncate font-medium`}>
                    {presetName(preset)}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-xs text-gray-500 dark:text-gray-400`}
                  >
                    {preset.builtIn ? words.builtInTag : words.savedTag}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    {!preset.builtIn && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={words.renameLabel(preset.name)}
                          onClick={() => startNaming({ mode: "rename", preset })}
                        >
                          {words.rename}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={words.deleteLabel(preset.name)}
                          onClick={() => setDeleting(preset)}
                        >
                          {words.delete}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {store.presets.length === 0 && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{words.manageEmpty}</p>
        )}
      </Modal>
      <ConfirmModal
        open={deleting !== null}
        title={words.deleteTitle}
        confirmLabel={words.delete}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          change((current) => deletePreset(current, id));
          toastSuccess(words.deleted(deleting.name));
          setDeleting(null);
        }}
      >
        <p className="text-sm">{deleting ? words.deleteConfirm(deleting.name) : ""}</p>
      </ConfirmModal>
    </>
  );
}
