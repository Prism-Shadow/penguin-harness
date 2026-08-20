/**
 * The machines routes' own gates — they run through the seam, BEFORE the runtime's auth
 * and json-only middlewares, so both rules live in the handler and are proven here:
 * desktop mode admits the login page (no session exists there yet), everything else needs
 * an admin session (none exists in this test's empty data root, so the check denies), and
 * a POST without the JSON content type is refused — that content type is what forces a
 * cross-origin browser into a preflight, i.e. the CSRF wall for the desktop-mode
 * exemption.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { machinesHttp } from "../src/machines/http.js";
import { MachinesService } from "../src/machines/service.js";

describe("machinesHttp", () => {
  let work: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-machines-http-"));
    // An empty HOME: no ~/.ssh/config, so the list is deterministically empty.
    originalHome = process.env.HOME;
    process.env.HOME = path.join(work, "home");
    fs.mkdirSync(process.env.HOME);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(work, { recursive: true, force: true });
  });

  const handler = (desktopMode: boolean) =>
    machinesHttp(new MachinesService(work), work, { desktopMode });

  it("declines paths it does not own", async () => {
    await expect(handler(true)(new Request("http://localhost:7376/api/me"))).resolves.toBeNull();
    await expect(
      handler(true)(new Request("http://localhost:7376/api/machinesque")),
    ).resolves.toBeNull();
  });

  it("desktop mode: the login page may list machines with no session", async () => {
    const res = await handler(true)(new Request("http://localhost:7376/api/machines"));
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ machines: [], job: null });
  });

  it("outside desktop mode an admin session is required (none here: no lock, no cookie)", async () => {
    const res = await handler(false)(new Request("http://localhost:7376/api/machines"));
    expect(res?.status).toBe(403);
  });

  it("a POST without the JSON content type is refused — the CSRF wall", async () => {
    const res = await handler(true)(
      new Request("http://localhost:7376/api/machines/connect", {
        method: "POST",
        // What a cross-site form or a no-preflight fetch can carry.
        headers: { "content-type": "text/plain" },
        body: '{"id":"ssh:x@y"}',
      }),
    );
    expect(res?.status).toBe(415);
  });

  it("a JSON POST without an id is a bad request", async () => {
    const res = await handler(true)(
      new Request("http://localhost:7376/api/machines/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res?.status).toBe(400);
  });
});
