import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { getMessages } from "../../src/cli/i18n.js";
import { runModelTool, splitModelToolArgs } from "../../src/cli/model-tool-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("keeps terminal paths out of command requests, including options before the file and -- operands", () => {
  expect(
    splitModelToolArgs(["--project-id=p", "stt", "--mime-type", "audio/wav", "--", "-录音.wav"]),
  ).toEqual({
    args: ["stt", "--mime-type", "audio/wav", "--", "client-audio"],
    projectId: "p",
    file: "-录音.wav",
  });
  expect(
    splitModelToolArgs([
      "status",
      "r",
      "--out=local result.wav",
      "--server",
      "https://example.test",
    ]),
  ).toEqual({
    args: ["status", "r", "--out", "client-file"],
    out: "local result.wav",
    server: "https://example.test",
  });
});

it("uploads only explicitly selected audio and downloads a scoped artifact only to the caller's target", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "penguin-terminal-files-"));
  try {
    const input = path.join(dir, "录音 file.wav");
    const output = path.join(dir, "客户端 output.wav");
    const bytes = Buffer.from("local audio recording");
    await writeFile(input, bytes);
    vi.stubEnv("PENGUIN_API_URL", "https://model-tools.test");
    vi.stubEnv("PENGUIN_PROJECT_ID", "project-B");
    vi.stubEnv("PENGUIN_SESSION_ID", "session-B");
    vi.stubEnv("PENGUIN_API_TOKEN", "fixture-credential");
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const paths: string[] = [];
    const bodies: string[] = [];
    const base = "https://model-tools.test/api/projects/project-B/capabilities";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      paths.push(String(url));
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-credential");
      if (String(url) === base + "/artifacts/recording") return new Response(bytes);
      expect(String(url)).toBe(base + "/cli");
      const payload = String(init.body);
      bodies.push(payload);
      const body = JSON.parse(payload);
      expect(body.sessionId).toBe("session-B");
      if (body.args[0] === "status")
        return Response.json({
          kind: "status",
          json: true,
          save: true,
          result: {
            artifacts: [
              { id: "recording", name: "recording.wav", url: "https://other.test/untrusted" },
            ],
          },
        });
      if (!body.audio) return Response.json({ kind: "audio" });
      expect(body.args).toEqual(["stt", "client-audio"]);
      expect(body.audio).toEqual({ mimeType: "audio/wav", data: bytes.toString("base64") });
      return Response.json({ kind: "message", stdout: "transcribed", stderr: "", exitCode: 0 });
    });
    const m = getMessages("en");
    expect(await runModelTool(["stt", input], m)).toBe(0);
    expect(await runModelTool(["status", "run-id", "--out", output], m)).toBe(0);
    expect(await readFile(output)).toEqual(bytes);
    // A server asking for an attachment cannot reinterpret a text operand as a local path.
    await expect(runModelTool(["search", "penguin"], m)).rejects.toThrow("Select an audio file");
    expect(bodies).toHaveLength(4);
    expect(bodies.join("")).not.toContain(dir);
    expect(paths.filter((p) => p === base + "/artifacts/recording")).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
