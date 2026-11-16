/**
 * The page half of the platform UI bridge: one registration, one held poll, and the four
 * commands the Agent can ask the screen.
 *
 * The loop is deliberately dull: ask the server for commands, run them one at a time, post
 * each answer, ask again. A page never runs two commands at once — a screenshot while the
 * picker is up would capture the picker — and a dropped connection costs one retry, not a
 * lost answer, because the server holds a command until its deadline.
 *
 * This file is not a React component: it outlives renders, and the layer that mounts it only
 * supplies the page's identity and the route to report.
 */
import { describeElement, elementByXpath } from "./dom";
import { startPick } from "./picker";
import { captureScreenshot } from "./screenshot";
import { collectUiState } from "./state";

/** One command as the server delivers it. */
export interface UiCommand {
  id: string;
  name: "state" | "screenshot" | "pick" | "element";
  payload?: Record<string, unknown>;
  issuedAt: string;
}

/** What the page posts back. */
export interface UiAnswer {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface PlatformUiBridgeOptions {
  pageId: string;
  /** The project on screen when the bridge started; reported, not used for routing. */
  projectId: string | null;
  /** The route and title as they are right now (the app changes them without remounting). */
  where: () => { route: string; title: string };
}

/** What the layer keeps to stop the loop. */
export interface PlatformUiBridge {
  pageId: string;
  stop(): void;
}

/** How long one poll is held; the page asks again immediately after. */
const POLL_WAIT_MS = 20_000;
/** How long to wait before retrying a failed registration or a broken loop. */
const RETRY_MS = 1_500;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function postJson(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Runs one command against this page. */
async function runCommand(
  command: UiCommand,
  where: () => { route: string; title: string },
): Promise<UiAnswer> {
  switch (command.name) {
    case "state":
      return { ok: true, value: collectUiState(where()) };
    case "screenshot": {
      const shot = await captureScreenshot();
      return { ok: true, value: shot };
    }
    case "pick": {
      const picked = await startPick("点击要发给助手的元素");
      if (picked === null) return { ok: false, error: "cancelled: the pick was dismissed" };
      return { ok: true, value: picked };
    }
    case "element": {
      const xpath = typeof command.payload?.["xpath"] === "string" ? command.payload["xpath"] : "";
      if (xpath === "") return { ok: false, error: "bad_request: no xpath" };
      const el = elementByXpath(xpath);
      if (el === null)
        return { ok: false, error: "not_found: nothing on this page has that xpath" };
      return { ok: true, value: describeElement(el) };
    }
    default:
      return { ok: false, error: `unknown_command: ${String(command.name)}` };
  }
}

/** Starts the loop; the returned handle stops it and abandons the held poll. */
export function startPlatformUiBridge(options: PlatformUiBridgeOptions): PlatformUiBridge {
  const controller = new AbortController();
  const base = `/api/platform-ui/pages/${encodeURIComponent(options.pageId)}`;

  const register = async (): Promise<boolean> => {
    const where = options.where();
    try {
      const response = await postJson(
        "/api/platform-ui/pages",
        {
          pageId: options.pageId,
          route: where.route,
          title: where.title,
          ...(options.projectId === null ? {} : { projectId: options.projectId }),
        },
        controller.signal,
      );
      return response.ok;
    } catch {
      return false;
    }
  };

  const loop = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const registered = await register();
      if (!registered) {
        await sleep(RETRY_MS, controller.signal);
        continue;
      }
      while (!controller.signal.aborted) {
        let response: Response;
        try {
          const where = options.where();
          response = await postJson(
            `${base}/poll`,
            { waitMs: POLL_WAIT_MS, route: where.route, title: where.title },
            controller.signal,
          );
        } catch {
          if (controller.signal.aborted) return;
          await sleep(RETRY_MS, controller.signal);
          continue;
        }
        if (response.status === 404) break; // the page was pruned: register again
        if (!response.ok) {
          await sleep(RETRY_MS, controller.signal);
          continue;
        }
        let commands: UiCommand[] = [];
        try {
          const data = (await response.json()) as { commands?: UiCommand[] };
          commands = Array.isArray(data.commands) ? data.commands : [];
        } catch {
          continue;
        }
        for (const command of commands) {
          let answer: UiAnswer;
          try {
            answer = await runCommand(command, options.where);
          } catch (err) {
            answer = { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
          try {
            await postJson(
              `${base}/answers`,
              {
                commandId: command.id,
                ok: answer.ok,
                ...(answer.value === undefined ? {} : { value: answer.value }),
                ...(answer.error === undefined ? {} : { error: answer.error }),
              },
              controller.signal,
            );
          } catch {
            // The caller's own deadline covers a lost answer; the loop keeps its place.
          }
        }
      }
    }
  };

  void loop();

  return {
    pageId: options.pageId,
    stop: () => {
      controller.abort();
      void fetch(base, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    },
  };
}
