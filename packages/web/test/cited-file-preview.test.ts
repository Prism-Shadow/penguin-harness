// @vitest-environment jsdom
/**
 * Opening a file cited in an organization's messages (features/company/cited-file-preview.tsx
 * and the capsule's click in path-capsule.tsx).
 *
 * - Given a surface that previews files, when a file capsule is clicked, the file opens with the
 *   label the writer gave it, and nothing is copied; a folder capsule there still copies.
 * - Given a surface without a preview (a ticket), a file capsule copies its path.
 * - Given a cited Markdown file, the preview reads it in the reader under its label, fetched by
 *   the path as written from the organization's file route.
 * - Given a file the server refuses, or one that is not there, the preview says which in a
 *   sentence and draws no file.
 * - Given an image, the preview draws it from the route once the server has answered for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { CitedFilePreview } from "../src/features/company/cited-file-preview";
import type { CitedFile } from "../src/features/company/cited-file-preview";
import { CitedFileOpenerProvider, PathMarkdown } from "../src/features/company/path-capsule";
import { S } from "../src/lib/strings";
import { click, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, stubFetch } from "./helpers/fetch";

const scope = { projectId: "p1" };
const DIR = "<app_data_dir>/organizations/co_lab/workspace/growth";
const REPORT = `${DIR}/weekly.md`;

afterEach(async () => {
  await unmountAll();
});

function capsule(path: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("aria-label") ?? "").endsWith(path),
  );
  if (found === undefined) throw new Error(`no capsule for ${path}`);
  return found;
}

describe("a capsule's click", () => {
  const text = `[Weekly](${REPORT}) in ${DIR}/`;

  it("opens a file with its label where the surface previews files, and copies a folder", async () => {
    const opened: CitedFile[] = [];
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount(
      createElement(CitedFileOpenerProvider, {
        open: (file: CitedFile) => opened.push(file),
        children: createElement(PathMarkdown, { text, scope }),
      }),
    );
    await click(capsule(REPORT));
    expect(opened).toEqual([{ path: REPORT, label: "Weekly" }]);
    expect(writeText).not.toHaveBeenCalled();

    await click(capsule(`${DIR}/`));
    expect(writeText).toHaveBeenCalledWith(`${DIR}/`);
    expect(opened).toHaveLength(1);
  });

  it("copies a file's path where the surface has no preview", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount(createElement(PathMarkdown, { text, scope }));
    await click(capsule(REPORT));
    expect(writeText).toHaveBeenCalledWith(REPORT);
  });
});

describe("the preview", () => {
  const show = (file: CitedFile) =>
    mount(createElement(CitedFilePreview, { projectId: "p1", orgId: "co_lab", file }));

  it("reads a cited Markdown file under its label, fetched by the path as written", async () => {
    const fetch = stubFetch(
      () => new Response("# Week 44\n\nSubmissions went up.", { status: 200 }),
    );
    const { container } = await show({ path: REPORT, label: "Weekly submissions" });
    await waitFor(() => container.textContent?.includes("Submissions went up.") ?? false);
    expect(container.querySelector("h1")?.textContent).toBe("Week 44");
    expect(container.textContent).toContain("Weekly submissions");
    expect(fetch.requests[0]?.path).toBe("/api/projects/p1/organizations/co_lab/file");
    expect(fetch.requests[0]?.query.get("path")).toBe(REPORT);
  });

  it.each([
    [403, S.company.citedFile.refused],
    [404, S.company.citedFile.notFound],
  ])("says why a %i file did not open, and draws none", async (status, sentence) => {
    stubFetch(() => apiError(status, status === 403 ? "org_file_refused" : "org_file_not_found"));
    const { container } = await show({ path: `${DIR}/chart.png` });
    await waitFor(() => container.textContent?.includes(sentence) ?? false);
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws an image from the route once the server has answered for it", async () => {
    stubFetch(() => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }));
    const { container } = await show({ path: `${DIR}/chart.png` });
    await waitFor(() => container.querySelector("img") !== null);
    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(src).toContain("/api/projects/p1/organizations/co_lab/file?path=");
  });
});
