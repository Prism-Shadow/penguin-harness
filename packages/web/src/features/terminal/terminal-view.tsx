/**
 * The reusable terminal surface: one xterm attached to one server-side terminal over the
 * binary WebSocket stream. Both terminal hosts render this — the standalone `/terminal`
 * page and the in-app dock (terminal-dock.tsx) — so attach/restore/resize behaviour is
 * identical wherever a terminal appears.
 *
 * The host decides *which* terminal to show via the `ensure` callback: it receives the
 * fitted geometry and returns the terminal to attach (reattaching to a stored id, creating
 * a fresh one, honouring URL parameters — whatever that host's policy is). This component
 * only knows how to attach to whatever `ensure` resolved.
 *
 * To restart with a different terminal, remount it (change the React `key`).
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { TerminalOpcode, decodeFrame, encodeFrame, encodeResize } from "./terminal-frames";

export interface TerminalInfo {
  id: string;
  /** Stable per-user display number (assigned at creation, never renumbered). */
  seq?: number;
  name: string;
  cwd: string;
  alive: boolean;
  /** Last OSC window title the shell set (debounced server-side), if any. */
  title?: string | null;
}

export type TerminalStatus = "connecting" | "ready" | "exited" | "error";

const THEME = {
  background: "#14171a",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  selectionBackground: "#3a4046",
};

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : ((await res.json()) as T);
}

function streamUrl(id: string, cols: number, rows: number): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/terminals/${id}/stream?cols=${cols}&rows=${rows}`;
}

export interface TerminalViewProps {
  /**
   * Resolves the terminal to attach, given the geometry the fitted xterm ended up with.
   * Runs once per mount; throwing reports status "error" with the message as detail.
   */
  ensure: (cols: number, rows: number) => Promise<TerminalInfo>;
  onStatus?: (status: TerminalStatus, detail: string) => void;
  onInfo?: (info: TerminalInfo) => void;
  /** OSC window-title changes, parsed by this client's own xterm from the byte stream. */
  onTitle?: (title: string) => void;
  className?: string;
}

export function TerminalView({ ensure, onStatus, onInfo, onTitle, className }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Kept in refs so the (intentionally once-per-mount) effect always calls the latest
  // callbacks without re-running when a parent re-renders with a new closure.
  const callbacks = useRef({ ensure, onStatus, onInfo, onTitle });
  callbacks.current = { ensure, onStatus, onInfo, onTitle };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let teardown: (() => void) | null = null;

    // Deferred by one macrotask on purpose. StrictMode mounts, unmounts and remounts this
    // effect synchronously in development; opening an xterm and disposing it inside that
    // window leaves xterm's own queued viewport sync to run against a disposed instance
    // ("cannot read properties of undefined (reading 'dimensions')"). Starting a tick later
    // means the throwaway mount never opens a terminal at all.
    const startTimer = setTimeout(() => {
      if (!cancelled) teardown = startTerminal(host);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      teardown?.();
    };

    function startTerminal(container: HTMLDivElement): () => void {
      let disposed = false;
      let socket: WebSocket | null = null;
      let exited = false;

      const report = (status: TerminalStatus, detail = ""): void => {
        if (!disposed) callbacks.current.onStatus?.(status, detail);
      };

      const term = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily:
          '"JetBrains Mono", "Fira Code", Menlo, Monaco, "DejaVu Sans Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(container);
      fit.fit();

      /** Copies the active selection and clears it — the visual ack that the copy happened. */
      const copySelection = (): void => {
        const selection = term.getSelection();
        if (!selection) return;
        void navigator.clipboard?.writeText(selection).catch(() => {});
        term.clearSelection();
      };
      /** Async-clipboard paste (the paths where no native paste event exists). */
      const pasteFromClipboard = (): void => {
        void navigator.clipboard
          ?.readText()
          .then((text) => text && term.paste(text))
          .catch(() => {}); // permission denied / insecure context: nothing to paste
      };

      /**
       * Terminal clipboard keys (the Windows Terminal / VS Code conventions — the single
       * Ctrl+Shift+C of the first cut was unreliable: Chrome grabs it for DevTools):
       * - copy: Ctrl+Shift+C, Ctrl+Insert, or plain Ctrl+C while a selection exists
       *   (SIGINT still goes through when nothing is selected);
       * - paste: Ctrl+V, Ctrl+Shift+V and Shift+Insert all ride the browser's NATIVE paste
       *   event into xterm's textarea (no clipboard permission involved) — the browser
       *   fires `paste` for every one of these, so returning false (skip xterm's own key
       *   handling, keep the browser default) is the whole implementation; calling the
       *   async clipboard API here as well double-pastes.
       */
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const key = event.key.toLowerCase();
        const copyCombo =
          (event.ctrlKey && event.shiftKey && key === "c") ||
          (event.ctrlKey && !event.shiftKey && event.key === "Insert") ||
          (event.ctrlKey && !event.shiftKey && !event.altKey && key === "c" && term.hasSelection());
        if (copyCombo) {
          copySelection();
          return false;
        }
        const pasteCombo =
          (event.ctrlKey && !event.altKey && key === "v") ||
          (!event.ctrlKey && event.shiftKey && event.key === "Insert");
        if (pasteCombo) {
          return false; // native paste path (see above)
        }
        return true;
      });

      /**
       * Terminal mouse conventions. All of these step aside when a full-screen app (vim,
       * htop) has turned mouse tracking on — the app owns the pointer then, and xterm
       * forwards the events as escape codes.
       */
      const listenerAbort = new AbortController();
      const { signal } = listenerAbort;
      const appOwnsMouse = (): boolean => term.modes.mouseTrackingMode !== "none";
      container.addEventListener(
        "contextmenu",
        (event) => {
          event.preventDefault(); // a terminal never shows the page's context menu
          if (appOwnsMouse()) return;
          // PuTTY-style right click: copy the selection if there is one, else paste.
          if (term.hasSelection()) copySelection();
          else pasteFromClipboard();
        },
        { signal },
      );
      container.addEventListener(
        "mousedown",
        (event) => {
          // Middle click: paste (the X11 convention; browser autoscroll is useless here).
          if (event.button === 1 && !appOwnsMouse()) {
            event.preventDefault();
            pasteFromClipboard();
          }
        },
        { signal },
      );
      // Click-to-focus anywhere in the view, padding included — finishing a selection drag
      // also lands here, which is fine: focusing xterm's textarea keeps the selection.
      container.addEventListener("mouseup", () => term.focus(), { signal });

      term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeFrame(TerminalOpcode.Input, data));
        }
      });

      // Title changes ride the ordinary byte stream (OSC 0/2); this client's xterm parses
      // them, so the host can mirror the live title (e.g. onto the dock's tab strip).
      term.onTitleChange((title) => {
        if (!disposed) callbacks.current.onTitle?.(title);
      });

      void (async () => {
        try {
          const terminal = await callbacks.current.ensure(term.cols, term.rows);
          if (disposed) return;
          callbacks.current.onInfo?.(terminal);

          socket = new WebSocket(streamUrl(terminal.id, term.cols, term.rows));
          socket.binaryType = "arraybuffer";

          socket.onopen = () => report("ready");
          socket.onmessage = (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const frame = decodeFrame(event.data);
            if (!frame) return;
            switch (frame.opcode) {
              // The restore stream is self-contained (reset + clear + repaint + cursor), so
              // it is written like any other output; calling term.reset() here would race
              // with xterm's parser instead.
              case TerminalOpcode.Restore:
              case TerminalOpcode.Output:
                term.write(frame.text);
                break;
              case TerminalOpcode.Exit: {
                const { exitCode } = JSON.parse(frame.text) as { exitCode: number };
                exited = true;
                report("exited", String(exitCode));
                break;
              }
              default:
                break;
            }
          };
          socket.onerror = () => report("error", "stream error");
          socket.onclose = () => {
            if (!exited) report("error", "stream closed");
          };
        } catch (err) {
          report("error", err instanceof Error ? err.message : String(err));
        }
      })();

      // Geometry changes are `update`s: this connection claimed the size when it attached
      // (?cols/?rows on the stream URL) and keeps ownership until it goes away.
      const observer = new ResizeObserver(() => {
        if (disposed) return;
        fit.fit();
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeResize(term.cols, term.rows, "update"));
        }
      });
      observer.observe(container);
      term.focus();

      return () => {
        disposed = true;
        listenerAbort.abort();
        observer.disconnect();
        socket?.close();
        term.dispose();
      };
    }
  }, []);

  return <div ref={hostRef} className={className ?? "min-h-0 flex-1 overflow-hidden"} />;
}
