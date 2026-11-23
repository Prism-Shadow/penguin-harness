import { expect, it, vi } from "vitest";
import * as client from "../src/api/client";
import { filesApi, filesScopeKey, type FilesScope } from "../src/api/workspace-files";
import { rememberSessionMachine } from "../src/lib/session-machines";

it("keeps same-named Session files, previews, and editor drafts on their chosen machines", async () => {
  const read = vi.spyOn(client, "apiFetch").mockResolvedValue({});
  const write = vi
    .spyOn(client, "apiFetchWithMeta")
    .mockResolvedValue({ data: undefined, serverNowMs: null, etag: null });
  const id = "shared-files";
  try {
    rememberSessionMachine(id, "different-machine");
    const local: FilesScope = { kind: "session", sessionId: id, machineId: null };
    const remote: FilesScope = { ...local, machineId: "lab" };
    expect(filesScopeKey(remote)).not.toBe(filesScopeKey(local));
    for (const scope of [local, remote]) {
      const api = filesApi(scope);
      const prefix = scope.machineId === null ? "" : "/server/lab";
      expect(api.fileUrl("notes.md")).toBe(
        prefix + "/api/sessions/shared-files/files/content?path=notes.md",
      );
      if (scope.machineId === null) {
        expect(api.isolatablePreviews).toBe(true);
        expect(api.previewUrl("slides.html")).toBe(
          "/api/sessions/shared-files/files/preview-redirect?path=slides.html",
        );
      } else {
        expect(api.isolatablePreviews).toBe(false);
        expect(api.previewUrl("slides.html")).toBe(
          "/server/lab/api/sessions/shared-files/files/content?path=slides.html&preview=1",
        );
      }
      await api.list("");
      await api.search("notes");
      await api.write("notes.md", "YQ==");
      await api.move({ from: "notes.md", to: "renamed.md" });
      await api.remove("renamed.md");
      expect(read.mock.calls.map(([, opts]) => opts?.server)).toEqual(
        Array(4).fill(scope.machineId),
      );
      expect(write.mock.calls[0]?.[1]?.server).toBe(scope.machineId);
      read.mockClear();
      write.mockClear();
    }
  } finally {
    rememberSessionMachine(id, null);
    vi.restoreAllMocks();
  }
});
