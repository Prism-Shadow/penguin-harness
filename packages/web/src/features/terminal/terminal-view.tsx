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
  name: string;
  cwd: string;
  alive: boolean;
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
  className?: string;
}

export function TerminalView({ ensure, onStatus, onInfo, className }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Kept in refs so the (intentionally once-per-mount) effect always calls the latest
  // callbacks without re-running when a parent re-renders with a new closure.
  const callbacks = useRef({ ensure, onStatus, onInfo });
  callbacks.current = { ensure, onStatus, onInfo };

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

      // Ctrl+Shift+C / Ctrl+Shift+V: the terminal convention, since plain Ctrl+C has to
      // stay SIGINT. Returning false stops xterm from also forwarding the key to the pty.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
        const key = event.key.toLowerCase();
        if (key === "c") {
          const selection = term.getSelection();
          if (selection) void navigator.clipboard?.writeText(selection);
          return false;
        }
        if (key === "v") {
          void navigator.clipboard?.readText().then((text) => text && term.paste(text));
          return false;
        }
        return true;
      });

      term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeFrame(TerminalOpcode.Input, data));
        }
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
        observer.disconnect();
        socket?.close();
        term.dispose();
      };
    }
  }, []);

  return <div ref={hostRef} className={className ?? "min-h-0 flex-1 overflow-hidden"} />;
}
