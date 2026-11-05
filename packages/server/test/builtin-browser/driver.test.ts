/**
 * The driver's contract over a fake shell: how a script is wrapped and evaluated, and how each
 * way a page can fail reaches the caller — a navigation under the script is `reloaded`, a throw
 * is the page's own message, a vanished tab is `no_such_tab`, silence is `timeout`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../../src/http/errors.js";
import {
  BrowserDriver,
  PageScriptError,
  exceptionMessage,
  mapLinkError,
} from "../../src/builtin-browser/driver.js";
import { ShellLink, ShellLinkError } from "../../src/builtin-browser/shell-link.js";
import { FakeShell, evaluated, expressionOf, tab } from "./fake-shell.js";

const links: ShellLink[] = [];
afterEach(() => {
  for (const link of links.splice(0)) link.dispose();
});

function setup() {
  const shell = new FakeShell();
  shell.show(tab(1));
  const link = new ShellLink(shell.port, { defaultTimeoutMs: 1_000 });
  links.push(link);
  const driver = new BrowserDriver(link, { sleep: async () => {} });
  return { shell, driver };
}

describe("BrowserDriver.evaluate", () => {
  it("wraps the code in an async function and asks for the value by value, as a user gesture", async () => {
    const { shell, driver } = setup();
    let seen: Record<string, unknown> | undefined;
    shell.cdp = (_tabId, method, params) => {
      expect(method).toBe("Runtime.evaluate");
      seen = params;
      return evaluated("Title");
    };
    await expect(
      driver.evaluate(1, "return document.title;", { timeoutMs: 4_000 }),
    ).resolves.toEqual({
      value: "Title",
    });
    expect(expressionOf(seen)).toBe("(async () => {\nreturn document.title;\n})()");
    expect(seen).toMatchObject({
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: 4_000,
    });
  });

  it("returns no value for undefined, and the text of an unserializable one", async () => {
    const { shell, driver } = setup();
    shell.cdp = () => evaluated(undefined);
    await expect(driver.evaluate(1, "return;")).resolves.toEqual({ value: undefined });
    shell.cdp = () => ({ result: { type: "number", unserializableValue: "NaN" } });
    await expect(driver.evaluate(1, "return NaN;")).resolves.toEqual({ value: "NaN" });
  });

  it("reports a navigation under the script as reloaded, whichever way CDP says it", async () => {
    const { shell, driver } = setup();
    for (const message of [
      "Execution context was destroyed.",
      "Inspected target navigated or closed",
      "Cannot find context with specified id",
    ]) {
      shell.cdp = () => {
        throw new Error(message);
      };
      await expect(driver.evaluate(1, "location.href = 'x'")).resolves.toEqual({ reloaded: true });
    }
    shell.cdp = () => ({
      result: { type: "object" },
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "Error: Execution context was destroyed." },
      },
    });
    await expect(driver.evaluate(1, "await x")).resolves.toEqual({ reloaded: true });
  });

  it("throws the page's own message when the script throws", async () => {
    const { shell, driver } = setup();
    shell.cdp = () => ({
      result: { type: "object", subtype: "error" },
      exceptionDetails: {
        text: "Uncaught (in promise)",
        exception: {
          description:
            "TypeError: Cannot read properties of null (reading 'click')\n    at <anonymous>:2:9",
        },
      },
    });
    const err = await driver
      .evaluate(1, "document.querySelector('#x').click()")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageScriptError);
    expect((err as Error).message).toBe(
      "TypeError: Cannot read properties of null (reading 'click')",
    );
  });

  it("maps a closed tab and a silent shell to the routes' codes", async () => {
    const { shell, driver } = setup();
    const gone = await driver.evaluate(2, "return 1;").catch((e: unknown) => e);
    expect(gone).toBeInstanceOf(HttpError);
    expect((gone as HttpError).code).toBe("no_such_tab");
    expect((gone as HttpError).status).toBe(404);

    shell.cdp = () => new Promise(() => {});
    const silent = await driver.cdp(1, "Page.reload", undefined, 30).catch((e: unknown) => e);
    expect((silent as HttpError).code).toBe("timeout");
    expect((silent as HttpError).status).toBe(504);

    shell.cdp = () => {
      throw new Error("'Page.nope' wasn't found");
    };
    const refused = await driver.cdp(1, "Page.nope").catch((e: unknown) => e);
    expect((refused as HttpError).code).toBe("cdp_error");
    expect((refused as HttpError).message).toBe("'Page.nope' wasn't found");
  });
});

describe("BrowserDriver.waitForLoad", () => {
  it("polls readyState through a navigation until the document is complete", async () => {
    const { shell, driver } = setup();
    const answers: Array<() => unknown> = [
      () => {
        throw new Error("Cannot find context with specified id");
      },
      () => evaluated("loading"),
      () => evaluated("interactive"),
      () => evaluated("complete"),
    ];
    let calls = 0;
    shell.cdp = () => answers[Math.min(calls++, answers.length - 1)]!();
    await expect(driver.waitForLoad(1, 5_000)).resolves.toBe(true);
    expect(calls).toBe(4);
  });

  it("gives up at the deadline, and stops at once for a closed tab", async () => {
    const shell = new FakeShell();
    shell.show(tab(1));
    const link = new ShellLink(shell.port);
    links.push(link);
    let now = 0;
    const driver = new BrowserDriver(link, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    shell.cdp = () => evaluated("loading");
    await expect(driver.waitForLoad(1, 1_000)).resolves.toBe(false);
    const err = await driver.waitForLoad(9, 1_000).catch((e: unknown) => e);
    expect((err as HttpError).code).toBe("no_such_tab");
  });
});

describe("error helpers", () => {
  it("prefers the exception's description, then its value, then CDP's text", () => {
    expect(exceptionMessage({ exception: { description: "Error: boom\n  at x" } })).toBe(
      "Error: boom",
    );
    expect(exceptionMessage({ text: "Uncaught", exception: { value: "plain" } })).toBe(
      "Uncaught plain",
    );
    expect(exceptionMessage({ text: "Uncaught" })).toBe("Uncaught");
  });

  it("passes non-link errors through", () => {
    const err = new Error("other");
    expect(mapLinkError(err, 1)).toBe(err);
    expect((mapLinkError(new ShellLinkError("closed", "x"), 1) as HttpError).code).toBe(
      "browser_unavailable",
    );
  });
});
