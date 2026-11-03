/**
 * The Settings dialog, mounted once beside every page (`WebAppModule.layers`): it opens on a
 * request (lib/settings-request.ts) — the account menu's Settings row, or a host asking for a
 * page — on the page the request names, else the viewer's first.
 */
import { useEffect, useState } from "react";
import { onSettingsRequest } from "../../lib/settings-request";
import type { SettingsSectionKey } from "../../lib/settings-sections";
import { SettingsDialog } from "./settings-dialog";

export function SettingsLayer() {
  const [open, setOpen] = useState(false);
  /** The page the last request asked for; undefined = the viewer's first. */
  const [section, setSection] = useState<SettingsSectionKey | undefined>(undefined);
  useEffect(
    () =>
      onSettingsRequest((request) => {
        setSection(request.section);
        setOpen(true);
      }),
    [],
  );
  return (
    <SettingsDialog
      open={open}
      onClose={() => setOpen(false)}
      {...(section !== undefined ? { section } : {})}
    />
  );
}
