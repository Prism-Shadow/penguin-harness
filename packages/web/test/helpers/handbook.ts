/**
 * The handbook suites' world: an organization's handbook routes behind the package's fetch fake
 * ({@link stubFetch}) and the handbook page mounted in its organization, with the app's one
 * discard prompt beside it.
 *
 * The server holds the documents it is given: GET lists them and reads one, PUT writes one and
 * echoes it, and a document it does not hold is a 404.
 */
import { createElement as h } from "react";
import { UnsavedPrompt } from "../../src/lib/unsaved/unsaved-prompt";
import { HandbookPage } from "../../src/features/company/handbook-page";
import { OrgContext } from "../../src/features/company/org-layout";
import { LocaleProvider } from "../../src/state/locale";
import { en } from "../../src/lib/strings-en";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch } from "./fetch";
import { button, hasButton, mount, waitFor } from "./dom";

const UPDATED = "2026-09-02T10:00:00.000Z";
const BASE = "/api/projects/p1/organizations/acme/handbook/files";

/** The two documents the editor suite works on. */
export const TWO_DOCUMENTS: Readonly<Record<string, string>> = {
  "README.md": "# Index",
  "conventions.md": "# Conventions",
};

/** The handbook's routes over `documents` (path to content). */
export function handbookServer(documents: Readonly<Record<string, string>>): FakeFetch {
  const docs = new Map(Object.entries(documents));
  return stubFetch((req) => {
    if (req.path === BASE) {
      return json({
        files: [...docs.keys()].map((path) => ({ path, size: 8, updatedAt: UPDATED })),
      });
    }
    const path = decodeURIComponent(req.path.slice(BASE.length + 1));
    if (req.method === "PUT") {
      docs.set(path, (req.body as { content: string }).content);
      return json({ path, content: docs.get(path) });
    }
    const content = docs.get(path);
    return content === undefined ? apiError(404, "not_found") : json({ path, content });
  });
}

/** Mounts the handbook over `documents`, beside the app's discard prompt. */
export async function mountHandbook(
  documents: Readonly<Record<string, string>>,
): Promise<FakeFetch> {
  const network = handbookServer(documents);
  await mount(
    h(
      LocaleProvider,
      null,
      h(
        OrgContext.Provider,
        { value: { projectId: "p1", orgId: "acme", org: null } },
        h(HandbookPage),
        h(UnsavedPrompt),
      ),
    ),
  );
  return network;
}

/** Mounts the handbook over `documents` and waits for the index to be open and editable. */
export async function openHandbook(
  documents: Readonly<Record<string, string>> = TWO_DOCUMENTS,
): Promise<FakeFetch> {
  const network = await mountHandbook(documents);
  await waitFor(() => hasButton(en.common.edit) && !button(en.common.edit).disabled);
  return network;
}
