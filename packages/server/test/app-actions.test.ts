/**
 * The App Center action message: an [app_center] origin block core's parser reads back, then
 * numbered instructions that name the registered commands and URL — or fall back to "the
 * process you started" when the registration carries none.
 */
import { describe, expect, it } from "vitest";
import { parseAppCenterMessage } from "@prismshadow/penguin-core/markers";
import { composeAppActionMessage } from "../src/runtime/app-actions.js";

const app = {
  id: "todo",
  name: "Todo app",
  url: "http://localhost:3000",
  startCommand: "npm start",
  stopCommand: "npm stop",
};

describe("composeAppActionMessage", () => {
  it("restart: block + stop / start / wait steps naming the commands and the URL", () => {
    const text = composeAppActionMessage(app, "restart");
    expect(parseAppCenterMessage(text)).toMatchObject({
      origin: { appId: "todo", appName: "Todo app", action: "restart" },
    });
    const body = parseAppCenterMessage(text)!.rest;
    expect(body).toContain('restart the app "Todo app" (id: todo)');
    expect(body).toContain("1. Stop the running process: run `npm stop`");
    expect(body).toContain("2. Start it again in the background: run `npm start`");
    expect(body).toContain("3. Wait until http://localhost:3000 responds");
  });

  it("stop: block + stop / verify steps, and no restart", () => {
    const body = parseAppCenterMessage(composeAppActionMessage(app, "stop"))!.rest;
    expect(body).toContain("1. Stop the running process: run `npm stop`");
    expect(body).toContain("2. Verify that http://localhost:3000 no longer responds");
    expect(body).toContain("Do not start it again unless the user asks.");
    expect(body).not.toContain("npm start");
  });

  it("without commands or a URL the steps point at the process the Session started", () => {
    const body = parseAppCenterMessage(
      composeAppActionMessage({ id: "cli-tool", name: "cli-tool" }, "restart"),
    )!.rest;
    expect(body).toContain("1. Stop the process you started for this app");
    expect(body).toContain(
      "2. Start it again in the background, the same way you started it before.",
    );
    expect(body).toContain("3. Verify that it is running, then confirm to the user.");
  });
});
