/**
 * What the app shows when the shell's tree cannot be drawn: a render error caught at its root
 * (app.tsx), or a module tree that failed to boot (main.tsx mounts `bootFailedRoot`). It leans
 * on nothing the broken tree provides — no router, no auth or Project context, no slot — only
 * the dictionary, the keymap and the UI package's plain controls, so it draws whatever broke.
 *
 * Its ways out: a reload; a reload in safe mode, which skips every server contribution (the
 * usual suspect once a plugin has added a page); and the harness history, to roll the harness
 * back when the build itself is what broke. The command palette mounts beside the tree and
 * stays reachable over this panel too.
 */
import { useState, type ComponentType } from "react";

import { Button, NoticeStrip } from "@prismshadow/penguin-ui";
import { useShortcutLabel } from "../lib/shortcuts/use-keymap";
import { S } from "../lib/strings";
import { HarnessHistoryOverlay } from "../web-app";
import { isSafeMode, setSafeMode } from "./safe-mode";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function RescuePanel({ error }: { error: unknown }) {
  const t = S.rescue;
  // Whether the error happened in safe mode, fixed when the panel appears: entering safe mode
  // afterwards from the palette does not make the error the app's own.
  const [safe] = useState(isSafeMode);
  const [historyOpen, setHistoryOpen] = useState(false);
  const palette = useShortcutLabel("palette.toggle");
  return (
    <div className="flex h-dvh w-full items-center justify-center overflow-y-auto bg-white px-4 py-8 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <section role="alert" aria-labelledby="rescue-title" className="w-full max-w-xl">
        <h1 id="rescue-title" className="text-lg font-semibold">
          {t.title}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t.desc}</p>
        <NoticeStrip
          tone="danger"
          className="mt-4 rounded-md border px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap"
        >
          {messageOf(error)}
        </NoticeStrip>
        {safe ? (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t.safeNote}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => location.reload()}>
            {t.reload}
          </Button>
          {safe ? null : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSafeMode(true);
                location.reload();
              }}
            >
              {t.reloadSafe}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
            {S.commandPalette.harnessHistory}
          </Button>
        </div>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">{t.paletteHint(palette)}</p>
      </section>
      <HarnessHistoryOverlay open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

/** The root the app mounts when the module tree failed to boot: the panel, with the boot error. */
export function bootFailedRoot(error: unknown): ComponentType {
  return function BootFailed() {
    return <RescuePanel error={error} />;
  };
}
