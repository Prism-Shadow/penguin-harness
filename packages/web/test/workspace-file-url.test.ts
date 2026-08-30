/**
 * A Workspace file's URL follows the Session to its machine.
 *
 * These addresses are URLs, not calls: they go straight into `fetch`, `<img src>`,
 * `<iframe src>` and a download `<a href>`, so the fetch wrapper that applies the Session
 * routing rule (lib/session-machines.ts) never sees them. Left bare, every preview, image,
 * PDF and download of a Session that lives on a machine asked THIS server for a Session it
 * does not have — and the workspace browser reports that failure as "preview not supported
 * for this type", because a file it cannot read looks exactly like one it cannot render.
 */
import { afterEach, describe, expect, it } from "vitest";
import { workspaceFileUrl } from "../src/api/endpoints";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";

const REMOTE = "QS7J4YVgSovi-Z2c";

afterEach(() => forgetSessionMachines());

describe("workspaceFileUrl", () => {
  it("is a plain path for a Session on this server", () => {
    expect(workspaceFileUrl("s-1", "notes/report.md")).toBe(
      "/api/sessions/s-1/files/content?path=notes%2Freport.md",
    );
  });

  it("is re-rooted onto the machine the Session lives on", () => {
    rememberSessionMachine("s-1", REMOTE);
    expect(workspaceFileUrl("s-1", "notes/report.md")).toBe(
      `/server/${REMOTE}/api/sessions/s-1/files/content?path=notes%2Freport.md`,
    );
  });

  it("keeps the download flag while it travels", () => {
    rememberSessionMachine("s-1", REMOTE);
    expect(workspaceFileUrl("s-1", "a.pdf", true)).toBe(
      `/server/${REMOTE}/api/sessions/s-1/files/content?path=a.pdf&download=1`,
    );
  });

  it("follows a Session that moved, since the rule is read at build time", () => {
    // The mapping is rebuilt by the lists that display Sessions; a URL built before the
    // mapping was known must not be the one the app keeps using.
    expect(workspaceFileUrl("s-2", "x.txt")).toBe("/api/sessions/s-2/files/content?path=x.txt");
    rememberSessionMachine("s-2", REMOTE);
    expect(workspaceFileUrl("s-2", "x.txt")).toBe(
      `/server/${REMOTE}/api/sessions/s-2/files/content?path=x.txt`,
    );
  });
});
