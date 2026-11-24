import { expect, it } from "vitest";
import { appUrl } from "../workbenches/first-workbench-guide/ui/guide-url.js";

it("a bookmarked guide keeps its mount, agent and machine when opening the product", () => {
  const guide = "first-workbench-guide";
  const path = "/api/projects/p/agents/a/workbenches/" + guide + "/ui/index.html";
  expect(appUrl(guide, path)).toBe("/app/p/a/" + guide);
  expect(appUrl(guide, "/front/server/desk" + path)).toBe(
    "/front/app/p/a/" + guide + "?machine=desk",
  );
  expect(appUrl(guide, "/settings")).toBeNull();
});
