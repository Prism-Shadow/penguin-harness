/**
 * The Files panel's folders and new files, its editor's place, copies on a plain-HTTP origin,
 * and the panel on a Workspace that has no Session yet.
 *
 * - A folder made from the tree header opens as the current directory; a text file made from
 *   a folder's menu starts as untitled.txt with its stem selected and opens in the editor; a
 *   taken name is refused and nothing is written.
 * - Renaming a folder moves its files, and the file open in the panel follows to its new path.
 * - Copy relative path on an origin without the async Clipboard API (plain HTTP, not
 *   localhost) writes the Workspace-relative path to the clipboard of the machine the browser
 *   is on.
 * - The editor keeps its place: Edit opens where the preview was scrolled, Save leaves it open
 *   with the caret and the scroll untouched, and a clean editor takes an Agent's rewrite in
 *   place, on the caret's line.
 * - A Workspace group's "Browse files" lands on a new-chat draft for that folder with its Files
 *   panel open, and "add to conversation" there stages the reference in the draft's composer; a
 *   temporary Workspace has nothing to browse and the toggle says why.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "filesfolders";
const P = "password123";

/** A Workspace directory of the test's own, named so its sidebar group can be found. */
function workspace(name, files) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-files-")), name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function setUp(page, workspaces) {
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const sessions = [];
  for (const dir of workspaces) {
    const res = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data: { workspace: dir } },
    );
    expect(res.ok(), "create session").toBeTruthy();
    sessions.push((await res.json()).session.sessionId);
  }
  return sessions;
}

async function openFiles(page, sessionId) {
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  return page.getByTestId("dock");
}

test("new folders and text files are made where asked, and a taken name changes nothing", async ({
  page,
}) => {
  const dir = workspace("newstuff", { "README.md": "# hi\n" });
  const [sid] = await setUp(page, [dir]);
  const dock = await openFiles(page, sid);
  await dock.locator('[data-tree-path="README.md"]').waitFor();

  await dock.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建文件夹" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("drafts");
  await page.getByRole("dialog").getByRole("textbox").press("Enter");
  await expect(dock.locator('[data-tree-path="drafts"]')).toBeVisible();
  expect(fs.statSync(path.join(dir, "drafts")).isDirectory()).toBe(true);

  await dock.locator('[data-tree-path="drafts"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建文本文件" }).click();
  const name = page.getByRole("dialog").getByRole("textbox");
  await expect(name).toHaveValue("untitled.txt");
  expect(await name.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([0, 8]);
  await page.keyboard.type("plan");
  await page.keyboard.press("Enter");
  await expect(dock.getByRole("textbox", { name: "编辑 plan.txt" })).toBeFocused();
  expect(fs.readFileSync(path.join(dir, "drafts", "plan.txt"), "utf8")).toBe("");

  // The blank space under the tree creates at the root; a taken name is refused there.
  const tree = await dock.locator('[role="tree"]').boundingBox();
  await page.mouse.click(tree.x + 30, tree.y + tree.height - 12, { button: "right" });
  await page.getByRole("menuitem", { name: "新建文本文件" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("README.md");
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("README.md 已存在，未做改动。").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(fs.readFileSync(path.join(dir, "README.md"), "utf8")).toBe("# hi\n");
});

test("renaming a folder moves its files and the open file follows", async ({ page }) => {
  const dir = workspace("renamer", { "docs/guide/intro.txt": "intro text\n" });
  const [sid] = await setUp(page, [dir]);
  const dock = await openFiles(page, sid);
  await dock.locator('[data-tree-path="docs"]').click();
  await dock.locator('[data-tree-path="docs/guide"]').click();
  await dock.locator('[data-tree-path="docs/guide/intro.txt"]').click();
  await expect(dock.getByText("intro text")).toBeVisible();

  await dock.locator('[data-tree-path="docs"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名 / 移动" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("handbook/docs-2026");
  await page.getByRole("dialog").getByRole("button", { name: "移动" }).click();

  const moved = dock.locator('[data-tree-path="handbook/docs-2026/guide/intro.txt"]');
  await expect(moved).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByText("intro text")).toBeVisible();
  expect(
    fs.readFileSync(path.join(dir, "handbook", "docs-2026", "guide", "intro.txt"), "utf8"),
  ).toBe("intro text\n");
  expect(fs.existsSync(path.join(dir, "docs"))).toBe(false);
});

test("copy relative path on a plain-HTTP origin writes the relative path", async ({ page }) => {
  const dir = workspace("copier", { "src/app.ts": "export {};\n" });
  const [sid] = await setUp(page, [dir]);
  // The page as a LAN address serves it: no secure context, so no async Clipboard API.
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { value: false });
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined });
  });
  const dock = await openFiles(page, sid);
  expect(await page.evaluate(() => [window.isSecureContext, typeof navigator.clipboard])).toEqual([
    false,
    "undefined",
  ]);
  await dock.locator('[data-tree-path="src"]').click();
  await dock.locator('[data-tree-path="src/app.ts"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制相对路径" }).click();
  await expect(page.getByText("已复制").first()).toBeVisible();
  // Read back from a page that has the API: the text is on this machine's clipboard.
  const reader = await page.context().newPage();
  await reader.goto(`${BASE}/`);
  expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe("src/app.ts");
  await reader.close();
});

test("the editor keeps its place through Edit, Save and an Agent's rewrite", async ({ page }) => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${String(i + 1).padStart(4, "0")}`);
  const dir = workspace("editor", { "long.txt": `${lines.join("\n")}\n` });
  const [sid] = await setUp(page, [dir]);
  const dock = await openFiles(page, sid);
  await dock.locator('[data-tree-path="long.txt"]').click();
  await dock.getByText("line 0001").first().waitFor();
  const body = dock
    .locator(".code-surface")
    .first()
    .locator("xpath=ancestor::div[contains(@class,'overflow-auto')][1]");
  await body.evaluate((el) => (el.scrollTop = 3000));

  await dock.getByRole("button", { name: "编辑" }).click();
  const host = dock.locator(".code-editor-host");
  const textarea = dock.locator("textarea");
  await expect(textarea).toBeFocused();
  expect(await host.evaluate((el) => el.scrollTop)).toBe(3000);
  const caretLine = () =>
    textarea.evaluate((el) => el.value.slice(0, el.selectionStart).split("\n").length);
  const openedOn = await caretLine();
  expect(openedOn).toBeGreaterThan(100);

  await page.keyboard.type("edited ");
  await page.keyboard.press("Control+s");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存").first()).toBeVisible();
  await expect(textarea).toBeFocused();
  expect(await host.evaluate((el) => el.scrollTop)).toBe(3000);
  expect(await caretLine()).toBe(openedOn);
  expect(fs.readFileSync(path.join(dir, "long.txt"), "utf8")).toContain("edited line");

  // The Agent rewrites a line further down while the editor holds nothing unsaved.
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.fill("files rewrite test sed -i 's/^line 0300$/line 0300 by the agent/' long.txt");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("The file was rewritten.")).toBeVisible();
  await expect.poll(() => textarea.inputValue()).toContain("line 0300 by the agent");
  expect(await caretLine()).toBe(openedOn);
  expect(await host.evaluate((el) => el.scrollTop)).toBe(3000);
  await expect(dock.getByText("磁盘上已变更")).toHaveCount(0);
});

test("Browse files on a Workspace group opens a draft on that folder, whose panel feeds the draft", async ({
  page,
}) => {
  const alpha = workspace("alpha-proj", { "README.md": "# Alpha\n" });
  const beta = workspace("beta-proj", { "notes.txt": "beta\n" });
  const [, sBeta] = await setUp(page, [alpha, beta]);
  await page.goto(`${BASE}/chat/${sBeta}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  await page
    .locator('div[class*="group/header"]')
    .filter({ hasText: "alpha-proj" })
    .getByRole("button", { name: "工作区选项" })
    .click();
  await page.getByRole("menuitem", { name: "打开文件浏览" }).click();
  await expect(page).toHaveURL(/\/chat\/new/);
  const dock = page.getByTestId("dock");
  await expect(dock.locator('[data-tree-path="README.md"]')).toBeVisible();
  await expect(page.getByTestId("dock-toggle-files")).toHaveAttribute("aria-expanded", "true");

  await dock.locator('[data-tree-path="README.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "添加到对话" }).click();
  await expect(page.getByRole("button", { name: "移除引用 README.md" })).toBeVisible();

  // A temporary Workspace: nothing to browse until the first message makes one.
  await page.getByRole("button", { name: "新建对话" }).first().click();
  const toggle = page.getByTestId("dock-toggle-files");
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await expect(toggle).toHaveAttribute("data-tooltip", /临时工作区在发送第一条消息时才创建/);
});
