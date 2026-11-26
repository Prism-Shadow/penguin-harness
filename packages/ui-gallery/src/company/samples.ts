/**
 * What the sample work delivered that is not language: the code changes the code workbench
 * diffs, and the pull requests they stand in. The prose around them is the dictionaries'.
 */
import type { FixtureId } from "./fixtures";

export interface CodeFile {
  path: string;
  before: string;
  after: string;
}

export interface CodeChange {
  pr: number;
  branch: string;
  files: readonly CodeFile[];
}

export const CODE: Partial<Record<FixtureId, CodeChange>> = {
  exportFix: {
    pr: 231,
    branch: "fix/export-filename-nfc",
    files: [
      {
        path: "src/export/filename.ts",
        before: `export function fileNameFor(title: string): string {
  const base = title.trim() || "untitled";
  return \`\${base}.md\`;
}
`,
        after: `const ILLEGAL = /[<>:"/\\\\|?*\\u0000-\\u001f]/g;

export function fileNameFor(title: string): string {
  const base = title.normalize("NFC").replace(ILLEGAL, "-").trim() || "untitled";
  return \`\${base}.md\`;
}
`,
      },
      {
        path: "test/export/filename.test.ts",
        before: "",
        after: `import { fileNameFor } from "../../src/export/filename";

it.each(["周报", "日本語のメモ", "café", "🐧 notes"])("keeps %s", (title) => {
  expect(fileNameFor(title)).toBe(\`\${title.normalize("NFC")}.md\`);
});

it("replaces characters Windows refuses", () => {
  expect(fileNameFor("a/b:c")).toBe("a-b-c.md");
});
`,
      },
    ],
  },
  syncDup: {
    pr: 233,
    branch: "fix/sync-duplicate-merge",
    files: [
      {
        path: "src/sync/merge.ts",
        before: `export function merge(local: Note[], remote: Note[]): Note[] {
  return [...local, ...remote.filter((note) => !local.includes(note))];
}
`,
        after: `export function merge(local: Note[], remote: Note[]): Note[] {
  const byId = new Map(local.map((note) => [note.id, note]));
  for (const note of remote) {
    const mine = byId.get(note.id);
    byId.set(note.id, mine === undefined ? note : resolve(mine, note));
  }
  return [...byId.values()];
}
`,
      },
    ],
  },
  installWin: {
    pr: 236,
    branch: "fix/windows-vcruntime",
    files: [
      {
        path: "installer/windows.nsi",
        before: `Section "Floe"
  File /r "dist\\*"
SectionEnd
`,
        after: `Section "Floe"
  Call EnsureVCRuntime
  File /r "dist\\*"
SectionEnd
`,
      },
    ],
  },
  ciCache: {
    pr: 224,
    branch: "ci/cache-keys",
    files: [
      {
        path: ".github/workflows/ci.yml",
        before: `key: playwright-\${{ runner.os }}-\${{ steps.date.outputs.today }}
`,
        after: `key: playwright-\${{ runner.os }}-\${{ hashFiles('pnpm-lock.yaml') }}
`,
      },
    ],
  },
};

/** The address the reseller's terms go back to, and the customer who asked about Pro. */
export const ADDRESSES = {
  resellerTerms: "partners@beichen.example",
  proInquiry: "lena@northwind.example",
};
