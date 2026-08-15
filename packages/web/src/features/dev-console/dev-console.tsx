/**
 * Developer console: a top-centered floating panel (portaled to body) showing the
 * running platform's identity and the HMR update feed. Controlled by the mount point
 * (dev-tools.tsx) — it opens through the Ctrl+P command palette's "open developer
 * console" action, not through a shortcut of its own.
 *
 * Runtime info (impl id / iface version) comes from GET /api/hmr/platform, admin-only:
 * a non-admin (or an admin whose session expired) gets a 403, which degrades this one
 * row to a note instead of failing the whole panel — the update feed below is always
 * local (sessionStorage) and unaffected.
 *
 * The update feed is fed by the SSE `web_updated` handler in state/sessions.tsx, not by
 * this component: that event triggers an immediate page reload, so there is never a
 * live window in which this panel could observe it directly (see lib/dev-console.ts's
 * module doc). This component only reads the feed back once on mount.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { HmrPlatformResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { isTopEscLayer, popEscLayer, pushEscLayer } from "../../components/ui/modal";
import { CloseButton } from "../../components/ui/icons";
import { formatDateTime } from "../../lib/format";
import { readDevConsoleEvents } from "../../lib/dev-console";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";

type PlatformState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; impl: string; ifaceVersion: number }
  | { kind: "forbidden" }
  | { kind: "error" };

export function DevConsole({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [platform, setPlatform] = useState<PlatformState>({ kind: "idle" });
  // sessionStorage is per-tab, so nothing else can append to the feed while this
  // component stays mounted — a plain lazy-init read is enough (see the module doc).
  const [events] = useState(() => readDevConsoleEvents(window.sessionStorage));

  // Escape closes it, but only when it's the topmost esc-consuming layer (shared stack
  // with Modal/Dropdown — see modal.tsx).
  useEffect(() => {
    if (!open) return;
    const id = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(id)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(id);
    };
  }, [open, onClose]);

  // Lazy, once-per-session fetch (same "don't fire on app load" convention as
  // use-version-info.ts): only the first time the panel opens, and only for an admin —
  // a non-admin session never even attempts the call.
  useEffect(() => {
    if (!open || platform.kind !== "idle") return;
    if (user?.isAdmin !== true) {
      setPlatform({ kind: "forbidden" });
      return;
    }
    let cancelled = false;
    setPlatform({ kind: "loading" });
    api
      .getHmrPlatform()
      .then((res: HmrPlatformResponse) => {
        if (!cancelled)
          setPlatform({ kind: "ok", impl: res.impl, ifaceVersion: res.iface.version });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPlatform({
          kind: err instanceof ApiError && err.status === 403 ? "forbidden" : "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, platform.kind, user]);

  if (!open) return null;

  const lastWebRev = events.length > 0 ? events[events.length - 1]!.rev : null;

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-[70] flex justify-center bg-black/45 px-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={S.devConsole.title}
        className="anim-pop h-fit w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-base font-semibold">{S.devConsole.title}</h2>
          <CloseButton onClose={onClose} />
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <section>
            <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
              {S.devConsole.runtimeHeading}
            </h3>
            <dl className="mt-2 space-y-1.5 text-sm">
              {platform.kind === "ok" && (
                <>
                  <InfoRow label={S.devConsole.implLabel} value={platform.impl} />
                  <InfoRow
                    label={S.devConsole.ifaceVersionLabel}
                    value={String(platform.ifaceVersion)}
                  />
                </>
              )}
              {(platform.kind === "forbidden" || platform.kind === "idle") && (
                <p className="text-gray-500 dark:text-gray-400">{S.devConsole.adminOnlyNote}</p>
              )}
              {platform.kind === "loading" && (
                <p className="text-gray-500 dark:text-gray-400">{S.common.loading}</p>
              )}
              {platform.kind === "error" && (
                <p className="text-red-600 dark:text-red-400">{S.devConsole.loadError}</p>
              )}
              <InfoRow
                label={S.devConsole.webRevLabel}
                value={lastWebRev ?? S.devConsole.webRevUnknown}
              />
            </dl>
          </section>

          <section className="mt-4">
            <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
              {S.devConsole.feedHeading}
            </h3>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {S.devConsole.feedEmpty}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {[...events].reverse().map((ev, i) => (
                  <li
                    key={`${ev.at}-${i}`}
                    className="flex items-baseline justify-between gap-3 rounded-md bg-gray-50 px-2.5 py-1.5 dark:bg-gray-800/60"
                  >
                    <span>{S.devConsole.feedEntry(ev.rev)}</span>
                    <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {formatDateTime(ev.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="border-t border-gray-200 px-4 py-2 text-right text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
          {S.devConsole.closeHint}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="font-mono text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}
