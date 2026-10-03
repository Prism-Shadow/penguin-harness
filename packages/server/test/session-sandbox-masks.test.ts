/**
 * The composer's view of a Session whose policy hides paths: `masksPaths` marks it, and
 * `maskPathsSupported` says whether a backend here can enforce it — where none can, every level
 * would refuse every command, and the composer says so.
 */
import { describe, expect, it } from "vitest";
import { sessionSandboxOf } from "../src/services/session-service.js";

describe("a Session's view when its policy masks paths", () => {
  it("is marked only by masked paths, never by a closed temp", () => {
    expect(sessionSandboxOf({ mode: "workspace-write", writableTemp: false }).masksPaths).toBe(
      undefined,
    );
    expect(
      sessionSandboxOf({ mode: "workspace-write", maskPaths: ["/k"] }, ["fs-write"]),
    ).toMatchObject({ masksPaths: true, maskPathsSupported: false, confinementSupported: true });
  });
});
