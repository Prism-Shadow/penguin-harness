import path from "node:path";
import { describe, expect, it } from "vitest";
import { webDistEntry, webDistFor } from "../src/web-dist.js";

describe("webDistFor", () => {
  it("pins a packaged app to its own web-dist", () => {
    expect(webDistFor({ isPackaged: true, appPath: "/opt/app/resources/app", env: {} })).toBe(
      path.join("/opt/app/resources/app", "web-dist"),
    );
  });

  it("leaves a source run to the server's default lookup", () => {
    // packages/desktop/web-dist does not exist in a checkout; the server falls back to
    // packages/web/dist on its own, which is what `pnpm desktop` relies on.
    expect(webDistFor({ isPackaged: false, appPath: "/src/packages/desktop", env: {} })).toBeNull();
  });

  it("an explicit PENGUIN_WEB_DIST wins in both forms; blank counts as unset", () => {
    for (const isPackaged of [true, false]) {
      expect(webDistFor({ isPackaged, appPath: "/x", env: { PENGUIN_WEB_DIST: "/srv/web" } })).toBe(
        "/srv/web",
      );
    }
    expect(webDistFor({ isPackaged: true, appPath: "/x", env: { PENGUIN_WEB_DIST: "  " } })).toBe(
      path.join("/x", "web-dist"),
    );
  });
});

describe("webDistEntry", () => {
  it("is the dist's index.html", () => {
    expect(webDistEntry("/srv/web")).toBe(path.join("/srv/web", "index.html"));
  });
});
