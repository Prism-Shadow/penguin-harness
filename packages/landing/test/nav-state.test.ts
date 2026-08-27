import { describe, expect, it } from "vitest";
import { getActiveNavItem } from "../src/lib/nav-state";

describe("landing navigation active state", () => {
  it("tracks known section hashes on the home page", () => {
    expect(getActiveNavItem("/", "#features")).toBe("features");
    expect(getActiveNavItem("/", "#self-improvement")).toBe("highlights");
    expect(getActiveNavItem("/", "#quickstart")).toBe("quickstart");
  });

  it("leaves the case section out of the reduced navigation", () => {
    expect(getActiveNavItem("/", "#cases")).toBeNull();
  });

  it("tracks the Blog route and blog posts", () => {
    expect(getActiveNavItem("/blog", "")).toBe("blog");
    expect(getActiveNavItem("/blog/release-notes", "")).toBe("blog");
  });

  it("does not mark unknown hashes or unrelated routes active", () => {
    expect(getActiveNavItem("/", "#unknown")).toBeNull();
    expect(getActiveNavItem("/blog", "#features")).toBe("blog");
    expect(getActiveNavItem("/other", "#features")).toBeNull();
  });
});
