/**
 * Layout regressions:
 * - the English draft page must not overflow horizontally on desktop (1280) or mobile (390)
 *   (the input card's toolbar row help text / button text must wrap to fit the **card width**;
 *   it used to blow out the card under English copy);
 * - the draft state doesn't show the context-usage ring (no session yet); it shows normally
 *   once inside a session;
 * - the models page at 390x844 must not overflow horizontally, and text must not overlap
 *   (the group header's provider name used to get pushed out of the button box and overlap
 *   the group-level actions);
 * - the sidebar's "New chat" button has no background fill (same gray-scale style as nav items);
 * - login page: a single brand penguin logo above the form (part of the form area; the
 *   background still only has the trace animation), the trace animation grows in after a
 *   delayed blank first paint, no two trace segments cross or touch (except where a fork shares
 *   an endpoint with its parent line), the language / theme controls work, and English sits
 *   left of 中文.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "layoutuser";
const P = "password123";

const docWidths = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

/** Count of pairwise rectangle intersections among visible leaf text elements (2px tolerance; ancestor-descendant pairs excluded). */
const textOverlapCount = (page) =>
  page.evaluate(() => {
    const isVisible = (el) => {
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    const leaves = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!isVisible(el)) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent && n.textContent.trim(),
      );
      if (!hasText) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      leaves.push({ el, r });
    }
    const TOL = 2;
    let count = 0;
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const a = leaves[i];
        const b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > TOL && h > TOL) count += 1;
      }
    }
    return count;
  });

test("layout: en draft + context gauge + mobile models", async ({ page }) => {
  // English copy is longer, making it the worst case for layout wrapping.
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
        { provider: "openai", modelId: "gpt-5.5", apiKey: "sk-mock2" },
        { provider: "google", modelId: "gemini-3-pro" },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  // --- Draft page: must not overflow horizontally on desktop or mobile; no context ring in draft state ---
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/chat/new`);
  await page.getByPlaceholder(/Type a message/).waitFor();
  let d = await docWidths(page);
  expect(d.scrollWidth, "draft @1280 no horizontal overflow").toBeLessThanOrEqual(d.clientWidth);
  await expect(page.locator('[title*="Context usage"]')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  d = await docWidths(page);
  expect(d.scrollWidth, "draft @390 no horizontal overflow").toBeLessThanOrEqual(d.clientWidth);

  // --- Session state shows the ring as usual (creating a session via the API and entering it directly, no need to actually run a Task) ---
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  await page.getByPlaceholder(/Type a message/).waitFor();
  await expect(page.locator('[title*="Context usage"]')).toHaveCount(1);

  // --- Models page @390: must not overflow, text must not overlap ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/models`);
  await page.getByText("claude-4-8").first().waitFor();
  d = await docWidths(page);
  expect(d.scrollWidth, "models @390 no horizontal overflow").toBeLessThanOrEqual(d.clientWidth);
  expect(await textOverlapCount(page), "models @390 no overlapping text").toBe(0);

  // --- Sidebar "New chat" button: no background fill (its resting state outside the draft page should have a transparent background) ---
  await page.setViewportSize({ width: 1280, height: 720 });
  const newChat = page.locator("nav").getByRole("button", { name: "New chat" });
  await expect(newChat).toBeVisible();
  expect(
    await newChat.evaluate((el) => getComputedStyle(el).backgroundColor),
    "new-chat button has no background fill",
  ).toBe("rgba(0, 0, 0, 0)");
});

test("layout: login — blank start, non-crossing traces, lang/theme controls", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByRole("heading", { name: "PenguinHarness" }).waitFor();

  // The only graphic asset is the brand penguin logo above the form; the
  // background still has only the trace animation, and the page must have no other img elements.
  await expect(page.locator("img")).toHaveCount(1);
  await expect(page.locator('img[src*="penguin-logo"]')).toBeVisible();

  // Asserting the mechanism behind the blank first paint: every trace's delay is non-negative
  // (no line is mid-animation on the first frame), and the base state (style before the
  // animation starts) is fully hidden — temporarily disable the animation to read the base
  // state, then restore it.
  const delays = await page.evaluate(() =>
    [...document.querySelectorAll(".login-trace")].map((el) =>
      parseFloat(getComputedStyle(el).animationDelay),
    ),
  );
  expect(delays.length, "traces rendered").toBeGreaterThanOrEqual(6);
  for (const d0 of delays) expect(d0, "non-negative delay").toBeGreaterThanOrEqual(0);
  const base = await page.evaluate(() => {
    const el = document.querySelector(".login-trace");
    el.style.animation = "none";
    const s = getComputedStyle(el);
    const r = { opacity: parseFloat(s.opacity), dashoffset: parseFloat(s.strokeDashoffset) };
    el.style.animation = "";
    return r;
  });
  expect(base.opacity, "pre-animation base state hidden").toBe(0);
  expect(base.dashoffset, "pre-animation base state undrawn").toBe(1);

  // No two trace segments cross or touch (judged by zero gap between bounding boxes; excludes a fork sharing an endpoint with its parent line).
  const touching = await page.evaluate(() => {
    const segs = [];
    document.querySelectorAll(".login-trace").forEach((p) => {
      const n = (p.getAttribute("d")?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 3 < n.length; i += 2) {
        segs.push({ x1: n[i], y1: n[i + 1], x2: n[i + 2], y2: n[i + 3] });
      }
    });
    const ends = (s) => [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ];
    let bad = 0;
    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        const a = segs[i];
        const b = segs[j];
        if (ends(a).some(([x, y]) => ends(b).some(([u, v]) => x === u && y === v))) continue;
        if (
          Math.min(a.x1, a.x2) <= Math.max(b.x1, b.x2) &&
          Math.max(a.x1, a.x2) >= Math.min(b.x1, b.x2) &&
          Math.min(a.y1, a.y2) <= Math.max(b.y1, b.y2) &&
          Math.max(a.y1, a.y2) >= Math.min(b.y1, b.y2)
        ) {
          bad += 1;
        }
      }
    }
    return bad;
  });
  expect(touching, "no crossing or touching trace segments").toBe(0);

  // Traces grow in after load: after a short wait, some trace should have entered its visible segment.
  await page.waitForTimeout(2600);
  const maxOpacity = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll(".login-trace")].map((el) =>
        parseFloat(getComputedStyle(el).opacity),
      ),
    ),
  );
  expect(maxOpacity, "traces grow in after load").toBeGreaterThan(0.5);

  // The English language option sits left of 中文 (asserted by geometric position); switching takes effect immediately (headless defaults to the en environment).
  const enBtn = page.getByRole("button", { name: "English", exact: true });
  const zhBtn = page.getByRole("button", { name: "中文", exact: true });
  const [enBox, zhBox] = [await enBtn.boundingBox(), await zhBtn.boundingBox()];
  expect(enBox.x, "English left of 中文").toBeLessThan(zhBox.x);
  await zhBtn.click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // Theme toggle: Dark adds html.dark, Light removes it.
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
