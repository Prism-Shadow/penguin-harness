import type { SocketHandlers } from "../../../../../library/terminal/src/web/terminal-connection";
import {
  decodeFrame,
  encodeFrame,
  TerminalOpcode,
} from "../../../../../library/terminal/src/web/terminal-frames";
import type { TerminalInfo } from "../../../../../library/terminal/src/web/terminal-view";
import { empty, fail, type Router } from "./router";
import { getStore, type DemoStore } from "./store";

interface DemoShell {
  info: TerminalInfo;
  line: string;
  screen: string;
  streams: Set<SocketHandlers>;
}

interface Catalog {
  sequence: number;
  shells: Map<string, DemoShell>;
}

const catalogs = new WeakMap<DemoStore, Catalog>();

function catalog(store: DemoStore): Catalog {
  let value = catalogs.get(store);
  if (!value) {
    value = { sequence: 0, shells: new Map() };
    catalogs.set(store, value);
  }
  return value;
}

const HELP = {
  en: "Preview terminal. Commands: pwd, echo, clear, help.",
  zh: "演示终端。可用命令：pwd、echo、clear、help。",
};

function frame(handlers: SocketHandlers, opcode: TerminalOpcode, text = "") {
  handlers.onMessage(encodeFrame(opcode, text).slice().buffer);
}

function create(store: DemoStore, sessionId: string | null, cwd: string): DemoShell {
  const data = catalog(store);
  const info = {
    id: crypto.randomUUID(),
    seq: ++data.sequence,
    name: "demo",
    cwd,
    sessionId,
    alive: true,
  };
  const shell = {
    info,
    line: "",
    screen: HELP[store.lang] + "\r\n$ ",
    streams: new Set<SocketHandlers>(),
  };
  data.shells.set(info.id, shell);
  return shell;
}

function shellById(store: DemoStore, id: string): DemoShell {
  return catalog(store).shells.get(id) ?? fail(404, "terminal_not_found", "Terminal not found.");
}

function closeShell(store: DemoStore, shell: DemoShell) {
  catalog(store).shells.delete(shell.info.id);
  for (const stream of shell.streams) {
    frame(stream, TerminalOpcode.Exit, "0");
    stream.onClose();
  }
  shell.streams.clear();
}

export function registerDemoTerminals(router: Router) {
  const list = "/api/terminals";
  const group = list + "/projects/:projectId/session-resources";
  router
    .get(list, ({ store }) => ({
      terminals: [...catalog(store).shells.values()].map((shell) => shell.info),
    }))
    .get(group, ({ store, params }) => {
      const counts: Record<string, number> = {};
      for (const { info } of catalog(store).shells.values()) {
        if (info.sessionId && store.session(info.sessionId)?.projectId === params.projectId) {
          counts[info.sessionId] = (counts[info.sessionId] ?? 0) + 1;
        }
      }
      return { counts };
    })
    .post(group + "/:sessionId/open", ({ store, params }) => {
      const session = store.session(params.sessionId!);
      if (!session || session.projectId !== params.projectId)
        return fail(404, "session_not_found", "Session not found.");
      const existing = [...catalog(store).shells.values()].find(
        (s) => s.info.sessionId === session.sessionId,
      );
      return (existing ?? create(store, session.sessionId, session.workspace)).info;
    })
    .post(group + "/close", ({ store, params, body }) => {
      const ids = (body as { sessionIds?: string[] } | null)?.sessionIds;
      if (!Array.isArray(ids)) return fail(400, "bad_request", "Expected Session IDs.");
      return {
        results: [...new Set(ids)].map((sessionId) => {
          let closed = 0;
          if (store.session(sessionId)?.projectId === params.projectId) {
            for (const shell of catalog(store).shells.values()) {
              if (shell.info.sessionId === sessionId) {
                closeShell(store, shell);
                closed++;
              }
            }
          }
          return { sessionId, closed };
        }),
      };
    })
    .post(list, ({ store, body }) => {
      const { sessionId, cwd } = (body ?? {}) as { sessionId?: string; cwd?: string };
      if (sessionId && !store.session(sessionId))
        return fail(404, "session_not_found", "Session not found.");
      return create(store, sessionId ?? null, cwd || "~").info;
    })
    .get(list + "/:id", ({ store, params }) => shellById(store, params.id!).info)
    .delete(list + "/:id", ({ store, params }) => {
      closeShell(store, shellById(store, params.id!));
      return empty();
    });
}

/** A handful of pure text commands keep the public demo entirely inside its browser frame. */
export function openDemoTerminal(url: string, handlers: SocketHandlers) {
  const ref = new URL(url).pathname.split("/").at(-2) ?? "";
  const [id, machine] = ref.split("@");
  const store = getStore().sessionsOn(machine || null);
  const shell = shellById(store, id ?? "");
  shell.streams.add(handlers);
  queueMicrotask(() => {
    if (!shell.streams.has(handlers)) return;
    handlers.onOpen();
    frame(handlers, TerminalOpcode.Restore, "\u001bc" + shell.screen);
  });
  const write = (text: string) => {
    shell.screen = (shell.screen + text).slice(-32768);
    for (const stream of shell.streams) frame(stream, TerminalOpcode.Output, text);
  };
  return {
    close: () => {
      shell.streams.delete(handlers);
    },
    send(bytes: Uint8Array) {
      const message = decodeFrame(bytes.slice().buffer);
      if (!message) return;
      if (message.opcode === TerminalOpcode.Ping)
        return frame(handlers, TerminalOpcode.Pong, message.text);
      if (message.opcode !== TerminalOpcode.Input) return;
      for (const char of message.text) {
        if (char === "\r" || char === "\n") {
          const line = shell.line.trim();
          shell.line = "";
          if (line === "clear") {
            shell.screen = "";
            write("\u001b[2J\u001b[H$ ");
            continue;
          }
          const result =
            line === "pwd"
              ? shell.info.cwd
              : /^echo(?:\s|$)/.test(line)
                ? line.slice(4).trimStart()
                : line
                  ? HELP[store.lang]
                  : "";
          write("\r\n" + (result ? result + "\r\n" : "") + "$ ");
        } else if (char === "\x7f" || char === "\b") {
          if (shell.line) {
            shell.line = shell.line.slice(0, -1);
            write("\b \b");
          }
        } else if (char === "\x03") {
          shell.line = "";
          write("^C\r\n$ ");
        } else if (char >= " " && shell.line.length < 4096) {
          shell.line += char;
          write(char);
        }
      }
    },
  };
}
