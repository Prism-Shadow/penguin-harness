# @prismshadow/skills

Checks that a skill directory's `SKILL.md` parses. The parser is vendored from
[vercel-labs/skills](https://github.com/vercel-labs/skills) (the `skills` CLI, MIT) at commit
[`18f96ea1`](https://github.com/vercel-labs/skills/tree/18f96ea131dab3b0fcc9b27cf7c6f6cbb6174680):
`src/frontmatter.ts` verbatim and `parseSkillMd` from `src/skills.ts`, under
`src/vendor/vercel-skills/` with the upstream `LICENSE`.

```ts
import { validateSkillDir } from "@prismshadow/skills";

const violations = await validateSkillDir("plugins/humanizer/skills/humanizer");
// [] when the parser accepts SKILL.md; otherwise ["<skill>/SKILL.md: <reason>"]
```

A skill is valid when that parser accepts it: the file is readable, its YAML frontmatter
parses, and `name` and `description` are present and are strings. The reasons are upstream's
own messages.

The vendored parser is this repository's one SKILL.md reader, and the package also exports it
with its writing counterpart (not vendored; upstream only reads):

```ts
import { formatFrontmatter, parseFrontmatter } from "@prismshadow/skills";

parseFrontmatter("---\nname: x\n---\n# Body\n"); // { data: { name: "x" }, content: "# Body\n" }
formatFrontmatter([["name", "x"], ["description", "Use it when: asked"]]);
// '---\nname: x\ndescription: "Use it when: asked"\n---'
```

`parseFrontmatter` throws when the block is not valid YAML. `formatFrontmatter` takes an object
or ordered `[key, value]` entries, leaves out undefined values, and keeps each value on one line;
its output reads back to the same values through `parseFrontmatter`.

## Updating the vendored copy

1. Check out vercel-labs/skills at the new commit.
2. Copy `src/frontmatter.ts` over `src/vendor/vercel-skills/frontmatter.ts` below its header,
   and port upstream's changes to `parseSkillMd` into `src/vendor/vercel-skills/skills.ts`,
   keeping the local changes listed in its header.
3. Update the commit SHA in both headers and in this README, refresh `LICENSE`, and run
   `pnpm format`.

Its only runtime dependency is `yaml` (upstream's own).

## Publishing

Inside this workspace the package resolves to its TypeScript source, so its consumers (each
plugin's `test/skills.test.ts`, and core) need no build. Core lists it as a devDependency and
bundles it into its own `dist` (tsup `noExternal`), so the published core does not depend on
this package. The published package is the `dist/` build:
`publishConfig.exports` points there, and `prepack` builds it and copies the repository's
`LICENSE` in (`postpack` removes the copy). Publish with `pnpm publish` from this directory; the
Vercel MIT notice ships as `src/vendor/vercel-skills/LICENSE`.
