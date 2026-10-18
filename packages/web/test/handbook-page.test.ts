// @vitest-environment jsdom
/**
 * The organization handbook (features/company/handbook-page.tsx) is the Files panel over the
 * handbook's directory, against a fake of the server: the handbook listing that names the
 * directory, and the Files panel's directory-addressed routes.
 *
 * - The page asks the handbook listing where the directory is, browses it through the Files
 *   panel's own routes, and opens the index on arrival.
 * - The index offers no rename and no delete, since every trigger tells an employee to read it;
 *   another document offers both.
 * - Nothing offers to add a file to a conversation: no conversation sits beside the page.
 */
import { act, createElement as h } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { HandbookPage } from "../src/features/company/handbook-page";
import { OrgContext } from "../src/features/company/org-layout";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ADMIN_ME } from "./helpers/admin-settings";
import { mount, settle, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";

const DIR = "/data/p1/organizations/acme/handbook";
const UPDATED = "2026-10-15T10:00:00.000Z";
const DOCUMENTS: Readonly<Record<string, string>> = {
  "README.md": "# Index\n\nStart with the conventions.",
  "conventions.md": "# Conventions\n\nWrite dates as ISO 8601.",
};

/** The handbook listing and the Files panel's routes over `DIR`. */
function server(): FakeFetch {
  return stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects/p1/organizations/acme/handbook/files") {
      return json({
        dir: DIR,
        files: Object.keys(DOCUMENTS).map((path) => ({ path, size: 40, updatedAt: UPDATED })),
      });
    }
    if (req.path.startsWith("/api/projects/p1/workspace-files")) {
      if (req.query.get("workspace") !== DIR) return apiError(404, "not_found");
      const path = req.query.get("path") ?? "";
      if (req.path.endsWith("/content")) {
        const content = DOCUMENTS[path];
        return content === undefined
          ? apiError(404, "not_found")
          : new Response(content, { headers: { "content-type": "text/markdown", etag: '"v1"' } });
      }
      return json({
        path,
        entries: Object.entries(DOCUMENTS).map(([name, text]) => ({
          name,
          kind: "file",
          sizeBytes: text.length,
          mtime: UPDATED,
        })),
      });
    }
    return apiError(404, "not_found");
  });
}

async function openHandbook(): Promise<FakeFetch> {
  const network = server();
  await mount(
    h(
      LocaleProvider,
      null,
      h(
        AuthProvider,
        null,
        h(
          OrgContext.Provider,
          { value: { projectId: "p1", orgId: "acme", org: null } },
          h(HandbookPage),
        ),
      ),
    ),
  );
  await waitFor(() => document.body.textContent?.includes("Start with the conventions.") === true);
  return network;
}

/** The menu a secondary click on a tree row opens, as its rows' labels. */
async function rowMenu(path: string): Promise<string[]> {
  const row = document.querySelector(`[data-tree-path="${path}"]`)!;
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }),
    );
  });
  await settle();
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent?.trim() ?? "",
  );
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
  return labels;
}

describe("the handbook", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    localStorage.setItem("penguin.lang", "en");
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("browses its directory with the Files panel's routes and opens the index", async () => {
    const network = await openHandbook();
    const browsed = network.requests.filter((r) => r.path.includes("/workspace-files"));
    expect(browsed.length).toBeGreaterThan(0);
    expect(browsed.every((r) => r.query.get("workspace") === DIR)).toBe(true);
    expect(browsed.some((r) => r.query.get("path") === "README.md")).toBe(true);
  });

  it("offers no rename or delete on the index, and both on another document", async () => {
    await openHandbook();
    const index = await rowMenu("README.md");
    expect(index).toContain(en.files.copyPath);
    expect(index).not.toContain(en.files.renameTitle);
    expect(index).not.toContain(en.common.delete);
    const other = await rowMenu("conventions.md");
    expect(other).toContain(en.files.renameTitle);
    expect(other).toContain(en.common.delete);
  });

  it("offers nothing to add to a conversation", async () => {
    await openHandbook();
    expect(await rowMenu("conventions.md")).not.toContain(en.files.addToChat);
  });
});
