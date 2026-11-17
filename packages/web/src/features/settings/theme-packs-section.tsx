/**
 * Settings → Appearance, the theme-pack group: every theme pack this server offers, the built-in
 * ones first, one row each — its colours in the current mode, its name, its version and what it
 * builds on — with Export on every row, Remove on an imported pack's, and the import row last.
 *
 * An admin imports per server, and every account picks from what is installed. So importing and
 * removing are an admin's: a member sees the rows, exports any of them, and reads a line saying
 * who imports. A built-in pack exports like any other, which is how a new pack starts (export
 * Frost, rename it, change a few values, import it), but it is never removed. Remove asks first;
 * importing an id that is already installed asks whether to replace it. Every press commits at
 * once, so there is nothing to save.
 *
 * The rows come from this browser's copy of the server's list while the page reads it again
 * (lib/account-sync/theme-packs.ts), so they never blank out, reorder or flicker while it loads.
 */
import { useState, type ChangeEvent } from "react";
import type { ThemeInvalidDetails, ThemePackDto } from "@prismshadow/penguin-server/api";
import {
  ConfirmModal,
  DownloadIcon,
  GlyphIcon,
  HiddenFileInput,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  IconButton,
  Pill,
  SettingRow,
  SettingsGroup,
  UploadIcon,
  buttonClass,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { downloadArchive } from "../../lib/archive-download";
import { acceptThemePacks, useThemePacks } from "../../lib/account-sync/theme-packs";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { useTheme } from "../../state/theme";
import { themeEntries, themeName, type ThemeEntry } from "../../state/theme-entries";

/** The server's own cap on an uploaded pack (PRFC-0026): a bigger file is refused before it goes. */
const MAX_PACK_BYTES = 16 * 1024 * 1024;

/** The file picker on a `<label>`, in the Button's look at the row's rung. */
const PICK_CLASS = buttonClass("secondary", "sm");

/** The installed list with `pack` in it: in place of the copy it replaces, else last. */
function withPack(list: readonly ThemePackDto[], pack: ThemePackDto): ThemePackDto[] {
  return list.some((p) => p.id === pack.id)
    ? list.map((p) => (p.id === pack.id ? pack : p))
    : [...list, pack];
}

/** Where a refusal points: the entry, and its line and column when the validator gave them. */
function refusalPlace(details: Partial<ThemeInvalidDetails>): string {
  return [details.file, details.line, details.line !== undefined ? details.column : undefined]
    .filter((part) => part !== undefined && part !== "")
    .join(":");
}

/** A pack's three colours in the mode on screen: page, ink and accent. Decoration beside its name. */
function PackSwatches({ entry, dark }: { entry: ThemeEntry; dark: boolean }) {
  const swatch = dark ? entry.swatches.dark : entry.swatches.light;
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1">
      {[swatch.canvas, swatch.ink, swatch.accent].map((color, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full border border-line"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

/** What a pack builds on, as the row's label says it and its hint explains it. */
function baseOf(entry: ThemeEntry): keyof typeof S.settings.themePacks.base {
  if (entry.builtin && entry.base === "modern") return "root";
  return entry.base;
}

/** An import that found its id installed: the file, kept to send again with `replace`. */
interface PendingReplace {
  file: Blob;
  /** The installed pack's name, or its id when this browser's list does not have it yet. */
  name: string;
}

export function ThemePacksSection() {
  const { user } = useAuth();
  const admin = user?.isAdmin === true;
  const { locale } = useLocale();
  const { dark } = useTheme();
  const installed = useThemePacks().value ?? [];
  const [importing, setImporting] = useState(false);
  const [replacing, setReplacing] = useState<PendingReplace | null>(null);
  const [removing, setRemoving] = useState<ThemeEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const nameOf = (pack: ThemeEntry | ThemePackDto): string =>
    "builtin" in pack ? themeName(pack, locale) : pack.names[locale] || pack.names.en;

  const exportPack = async (entry: ThemeEntry) => {
    try {
      await downloadArchive(api.themePackExportUrl(entry.id), `${entry.id}-${entry.version}`);
    } catch (err) {
      toastApiError(err);
    }
  };

  const upload = async (file: Blob, replace: boolean) => {
    setImporting(true);
    try {
      const { theme } = await api.importThemePack(file, replace);
      acceptThemePacks(withPack(installed, theme));
      toastSuccess(
        (replace ? S.settings.themePacks.replaced : S.settings.themePacks.imported)(nameOf(theme)),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === "theme_exists" && !replace) {
        const id = err.details?.themeId ?? "";
        const pack = installed.find((p) => p.id === id);
        setReplacing({ file, name: pack !== undefined ? nameOf(pack) : id });
        return;
      }
      if (err instanceof ApiError && err.code === "theme_invalid" && err.details !== undefined) {
        toastError(
          S.settings.themePacks.invalid(
            refusalPlace(err.details),
            err.details.reason ?? err.message,
          ),
        );
        return;
      }
      toastApiError(err);
    } finally {
      setImporting(false);
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared before anything else, so picking the same file again fires a change again.
    e.target.value = "";
    if (file === undefined) return;
    if (file.size > MAX_PACK_BYTES) {
      toastError(S.settings.themePacks.tooLarge);
      return;
    }
    void upload(file, false);
  };

  const confirmReplace = () => {
    if (replacing === null) return;
    const { file } = replacing;
    setReplacing(null);
    void upload(file, true);
  };

  const confirmRemove = async () => {
    if (removing === null) return;
    setRemoveBusy(true);
    try {
      await api.deleteThemePack(removing.id);
      acceptThemePacks(installed.filter((p) => p.id !== removing.id));
      toastSuccess(S.settings.themePacks.removed(nameOf(removing)));
    } catch (err) {
      toastApiError(err);
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  };

  const T = S.settings.themePacks;
  return (
    <>
      <SettingsGroup title={T.title}>
        {themeEntries(installed).map((entry) => {
          const name = nameOf(entry);
          const base = baseOf(entry);
          return (
            <SettingRow
              key={entry.id}
              title={
                <span className={`flex min-w-0 items-center ${ICON_GAP.menu}`}>
                  <PackSwatches entry={entry} dark={dark} />
                  <span
                    className={`min-w-0 truncate ${entry.loadable ? "" : "text-fg-muted"}`}
                    data-tooltip={T.idHint(entry.id)}
                    data-tooltip-extra
                  >
                    {name}
                  </span>
                  <span className={`flex shrink-0 items-center ${ICON_GAP.row}`}>
                    <Pill>{T.versionLabel(entry.version)}</Pill>
                    <Pill tooltip={T.baseHint[base]}>{T.base[base]}</Pill>
                    {!entry.loadable && (
                      <Pill tone="attention" tooltip={T.newerApiHint}>
                        {T.newerApi}
                      </Pill>
                    )}
                  </span>
                </span>
              }
            >
              <IconButton
                size="sm"
                variant="ghost"
                label={T.exportLabel(name)}
                title={T.export}
                onClick={() => void exportPack(entry)}
              >
                <DownloadIcon size={ICON_SIZE.iconButton} />
              </IconButton>
              {admin && !entry.builtin && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={T.removeLabel(name)}
                  title={T.remove}
                  onClick={() => setRemoving(entry)}
                >
                  <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                </IconButton>
              )}
            </SettingRow>
          );
        })}
        {admin ? (
          <SettingRow title={T.importTitle} description={T.importHint}>
            <label className={`${PICK_CLASS} ${importing ? "pointer-events-none opacity-60" : ""}`}>
              <HiddenFileInput accept=".zip" disabled={importing} onChange={onPick} />
              <UploadIcon size={ICON_SIZE.inlineGlyph} />
              {importing ? T.importing : T.importPick}
            </label>
          </SettingRow>
        ) : (
          <SettingRow title={T.importTitle} description={T.adminOnly} />
        )}
      </SettingsGroup>
      <ConfirmModal
        open={replacing !== null}
        title={replacing !== null ? T.replaceTitle(replacing.name) : ""}
        tone="primary"
        onClose={() => setReplacing(null)}
        onConfirm={confirmReplace}
        confirmLabel={T.replace}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-fg-muted">
          {replacing !== null ? T.replaceBody(replacing.name) : ""}
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={removing !== null}
        title={removing !== null ? T.removeTitle(nameOf(removing)) : ""}
        busy={removeBusy}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        confirmLabel={T.remove}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-fg-muted">
          {removing !== null ? T.removeBody(nameOf(removing)) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
