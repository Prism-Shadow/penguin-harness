/**
 * Core names no plugin library of its own: the server, the CLI and the desktop app are the
 * library's hosts, and core does not depend on the plugin packages. A test that creates
 * default_agent — which installs the library's preinstalled plugins — would otherwise fail on
 * the library call, so every core test file starts with an empty host named: the library is
 * empty, and default_agent gets no plugins. A test that needs a library points core at a fixture
 * host with usePushedPluginLibrary, which outranks this one, and sets it back to null after.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { useLibraryHost } from "../../src/plugin/library-host.js";

const host = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-core-library-host-"));
fs.writeFileSync(
  path.join(host, "package.json"),
  JSON.stringify({ name: "core-test-library-host", private: true }),
);
useLibraryHost(host);

afterAll(() => {
  fs.rmSync(host, { recursive: true, force: true });
});
