/**
 * Agent packages: a plugin package whose definition part is an Agent's definition.
 * The three rules under test (proposal: an Agent may be a plugin with an optional
 * package.json; a package that is an Agent is downloaded through the plugin channels;
 * what follows the download is a COPY into the Project — nothing executes):
 *
 *   - a zip WITHOUT a package.json is an Agent package: names come from the directory
 *     (or agent.json), and the definition copies;
 *   - the copy is exactly the definition: the runtime directories (traces, snapshots,
 *     workspaces, memory, the vault, scratchpad) never leave the package, and missing
 *     defaults are written as data;
 *   - nothing executes: copying writes bytes and nothing else, and a package without
 *     the Agent keyword or definition parts refuses to be re-copied as one.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import {
  AGENT_PACKAGE_KEYWORD,
  agentPackageFiles,
  copyAgentPackage,
  reinstallAgentPackage,
  AgentPackageError,
} from "../src/agents/package.js";
import { parseAgentPackageArchive } from "../src/services/agent-package-archive.js";

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`;

const agentZip = (files: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v) as Uint8Array]),
    ),
  );

const unpacked = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]));

const definition = {
  "my-agent/agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
  "my-agent/agent_state/system_config.yaml": "version: 1\n",
  "my-agent/agent_state/AGENTS.md": "# guidance\n",
};

describe("agent packages", () => {
  it("a zip without a package.json is an Agent package, named by its directory", async () => {
    const pkg = await parseAgentPackageArchive(agentZip(definition));
    expect(pkg.manifest).toBe(false);
    expect(pkg.agentId).toBe("my-agent");
    expect(pkg.name).toBe("my-agent");
    // The definition files are the package; nothing else is demanded.
    expect([...pkg.files.keys()].sort()).toEqual([
      "agent_state/AGENTS.md",
      "agent_state/skills/review/SKILL.md",
      "agent_state/system_config.yaml",
    ]);
  });

  it("package.json is optional, and the keyword marks it when it is there", async () => {
    const marked = await parseAgentPackageArchive(
      agentZip({
        "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
        "package.json": JSON.stringify({
          name: "@acme/reviewer",
          version: "1.2.0",
          keywords: ["other", AGENT_PACKAGE_KEYWORD],
        }),
        "agent.json": JSON.stringify({ id: "reviewer" }),
      }),
    );
    expect(marked.manifest).toBe(true);
    expect(marked.name).toBe("@acme/reviewer");
    expect(marked.agentId).toBe("reviewer");
  });

  it("a keyworded package.json requires a release version", async () => {
    await expect(
      parseAgentPackageArchive(
        agentZip({
          "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
          "package.json": JSON.stringify({
            name: "@acme/reviewer",
            keywords: [AGENT_PACKAGE_KEYWORD],
          }),
        }),
      ),
    ).rejects.toThrow(/release version/);
  });

  it("an agent.json that lists a file the package does not carry is refused", async () => {
    const zip = agentZip({
      ...definition,
      "my-agent/agent.json": JSON.stringify({ files: ["agent_state/skills/ghost/SKILL.md"] }),
    });
    await expect(parseAgentPackageArchive(zip)).rejects.toThrow(/ghost/);
  });

  it("a zip with neither a package.json nor a definition is not an Agent package", async () => {
    await expect(
      parseAgentPackageArchive(agentZip({ "README.md": "not an agent\n" })),
    ).rejects.toThrow(/Not an Agent package/);
  });

  it("the copy is exactly the definition, and the lived history never leaves the package", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-copy-"));
    try {
      const files = unpacked({
        ...definition,
        // The parts an Agent package never carries, planted to prove the copy drops them.
        "my-agent/agent_state/.vault.toml": "TOKEN = \"secret\"\n",
        "my-agent/agent_state/memory/user/MEMORY.md": "# memory\n",
        "my-agent/traces/v1.jsonl": "{}\n",
        "my-agent/snapshots/v1.tar.gz": "bytes",
        "my-agent/workspaces/w/state.json": "{}\n",
        "my-agent/scratchpad/s1/note.md": "note\n",
      });
      const out = await copyAgentPackage({
        root,
        projectId: "default_project",
        agentId: "my-agent",
        files,
      });
      expect(out.agentId).toBe("my-agent");
      const dir = path.join(root, "default_project", "agents", "my-agent");
      // The definition is there…
      await expect(
        fs.readFile(path.join(dir, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(definition["my-agent/agent_state/skills/review/SKILL.md"]);
      await expect(
        fs.readFile(path.join(dir, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe(definition["my-agent/agent_state/system_config.yaml"]);
      // …and nothing that was lived:
      await expect(fs.access(path.join(dir, "agent_state", ".vault.toml"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "agent_state", "memory"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "traces"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "snapshots"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "workspaces"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "scratchpad"))).rejects.toThrow();
      expect(out.copied).toEqual([
        "agent_state/skills/review/SKILL.md",
        "agent_state/system_config.yaml",
        "agent_state/AGENTS.md",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("a package without system_config.yaml or AGENTS.md gets the defaults, written as data", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-default-"));
    try {
      const out = await copyAgentPackage({
        root,
        projectId: "default_project",
        agentId: "plain",
        files: unpacked({
          "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
        }),
      });
      expect(out.copied).toContain("system_config.yaml");
      expect(out.copied).toContain("AGENTS.md");
      const config = await fs.readFile(
        path.join(root, "default_project", "agents", "plain", "agent_state", "system_config.yaml"),
        "utf8",
      );
      expect(config).toContain("version: 1");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("copying never executes and never overwrites: an existing Agent directory refuses", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-exists-"));
    try {
      const dir = path.join(root, "default_project", "agents", "my-agent");
      await fs.mkdir(path.join(dir, "agent_state"), { recursive: true });
      await fs.writeFile(path.join(dir, "agent_state", "system_config.yaml"), "version: 7\n");
      await expect(
        copyAgentPackage({ root, projectId: "default_project", agentId: "my-agent", files: unpacked(definition) }),
      ).rejects.toThrow(/already exists/);
      // The lived definition is untouched.
      await expect(
        fs.readFile(path.join(dir, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe("version: 7\n");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("re-copying an installed package runs no scripts: it is a copy of files, nothing else", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-reinstall-"));
    try {
      const prefix = path.join(root, "plugins");
      const dir = path.join(prefix, "node_modules", "reviewer");
      await fs.mkdir(path.join(dir, "agent_state", "skills", "review"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "reviewer", version: "1.0.0", keywords: [AGENT_PACKAGE_KEYWORD] }),
      );
      await fs.writeFile(
        path.join(dir, "agent_state", "skills", "review", "SKILL.md"),
        skill("review", "reviews code"),
      );
      const before = await agentPackageFiles(dir);
      const out = await reinstallAgentPackage({ root, projectId: "default_project", name: "reviewer", dir });
      expect(out.agentId).toBe("reviewer");
      // The copy in the Project is byte-for-byte the package's definition files.
      const copied = path.join(root, "default_project", "agents", "reviewer");
      await expect(
        fs.readFile(path.join(copied, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("review", "reviews code"));
      // The package itself is unchanged — nothing wrote into it, nothing ran from it.
      expect(Object.fromEntries(before)).toEqual(Object.fromEntries(await agentPackageFiles(dir)));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("a package that is not an Agent package refuses to be re-copied as one", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-notagent-"));
    try {
      const dir = path.join(root, "plugins", "node_modules", "plain");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "plain", version: "1.0.0" }),
      );
      await expect(
        reinstallAgentPackage({ root, projectId: "default_project", name: "plain", dir }),
      ).rejects.toThrow(AgentPackageError);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
