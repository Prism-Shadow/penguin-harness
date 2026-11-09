/**
 * The server's self-update classifier, as the CLI's refusals meet it.
 *
 * POST /api/version/update reads a clean `penguin update` exit as a refusal ("unsupported")
 * when its output carries one of the server's UPDATE_REFUSAL_MARKERS, and as "updated"
 * otherwise. The server cannot import the CLI, so the markers are English fragments of the
 * CLI's refusal copy, read here from the server's own contract:
 *
 * - Given every refusal the server can see (it always runs with `--yes`), the English message
 *   carries one of the server's markers, so the server reports it as unsupported.
 * - Every marker the server matches still occurs in one of those messages.
 */
import { UPDATE_REFUSAL_MARKERS } from "@prismshadow/penguin-server/api";
import { describe, expect, it } from "vitest";
import { getMessages } from "../src/i18n.js";

const en = getMessages("en").update;

/** The refusals a server-run `penguin update --yes` can print; the argument values are arbitrary. */
const REFUSALS: Record<string, string> = {
  sourceCheckout: en.sourceCheckout(),
  unknownInstall: en.unknownInstall("/opt/penguin/cli.js"),
  npmUnknownManager: en.npmUnknownManager("/usr/lib/node_modules", "1.2.3"),
  windowsUnsupported: en.windowsUnsupported(),
  windowsGlobalInstall: en.windowsGlobalInstall("npm install -g @prismshadow/penguin-cli@1.2.3"),
};

describe("update refusals and the server's classifier", () => {
  it.each(Object.entries(REFUSALS))("update.%s reads as a refusal to the server", (_name, text) => {
    expect(UPDATE_REFUSAL_MARKERS.some((marker) => text.includes(marker))).toBe(true);
  });

  it("matches nothing the refusals no longer say", () => {
    for (const marker of UPDATE_REFUSAL_MARKERS) {
      expect(
        Object.values(REFUSALS).some((text) => text.includes(marker)),
        marker,
      ).toBe(true);
    }
  });
});
