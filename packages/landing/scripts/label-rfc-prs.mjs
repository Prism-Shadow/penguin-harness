#!/usr/bin/env node
/**
 * Label RFC pull requests on GitHub with `request-for-comments` and refresh the offline PR status
 * snapshot (`src/lib/rfc-pr-status.json` + `node_modules/.cache/penguin-rfcs/pr-status.json`).
 *
 * Usage:
 *   node scripts/label-rfc-prs.mjs [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CACHE_FILE,
  refreshRfcPrStatusCache,
  REPO_NAME,
  REPO_OWNER,
  RFC_LABEL,
  runGithubGraphql,
  SEED_FILE,
} from "./rfcs/pr-status.mjs";

const dryRun = process.argv.includes("--dry-run");
const repoSlug = `${REPO_OWNER}/${REPO_NAME}`;

function ensureLabel(repo) {
  if (dryRun) {
    console.log(`[dry-run] ensure label '${RFC_LABEL}' on ${repo}`);
    return;
  }
  execFileSync(
    "gh",
    [
      "label",
      "create",
      RFC_LABEL,
      "--repo",
      repo,
      "--color",
      "1d76db",
      "--description",
      "Design RFC (PRFC) pull request",
      "--force",
    ],
    { stdio: "ignore" },
  );
}

function findRfcPrsToLabel() {
  let cursor = null;
  const toLabel = [];
  const alreadyLabeled = [];

  while (true) {
    const after = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
    const query = `{
      repository(owner: ${JSON.stringify(REPO_OWNER)}, name: ${JSON.stringify(REPO_NAME)}) {
        pullRequests(states: [OPEN, MERGED, CLOSED], first: 100, orderBy: {field: CREATED_AT, direction: DESC}${after}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            labels(first: 20) { nodes { name } }
            files(first: 100) { nodes { path } }
          }
        }
      }
    }`;
    const data = runGithubGraphql(query);
    const conn = data?.repository?.pullRequests;
    for (const pr of conn?.nodes ?? []) {
      const touchesRfc = (pr.files?.nodes ?? []).some((f) =>
        /^rfcs\/PRFC-\d+-.+\.md$/.test(f.path),
      );
      if (!touchesRfc) continue;
      const hasLabel = (pr.labels?.nodes ?? []).some((l) => l.name === RFC_LABEL);
      if (hasLabel) {
        alreadyLabeled.push(pr.number);
      } else if (/^docs\b|PRFC/i.test(pr.title)) {
        toLabel.push(pr.number);
      }
    }
    const oldest = conn?.nodes?.[conn.nodes.length - 1];
    if (!conn?.pageInfo?.hasNextPage || (oldest && oldest.number < 1200)) break;
    cursor = conn.pageInfo.endCursor;
  }

  return {
    toLabel: toLabel.sort((a, b) => a - b),
    alreadyLabeled: alreadyLabeled.sort((a, b) => a - b),
  };
}

ensureLabel(repoSlug);
const { toLabel, alreadyLabeled } = findRfcPrsToLabel();
console.log(
  `[label-rfc-prs] ${repoSlug}: ${alreadyLabeled.length} already labeled, ${toLabel.length} to label`,
);

for (const num of toLabel) {
  if (dryRun) {
    console.log(`[dry-run] gh pr edit ${num} --repo ${repoSlug} --add-label ${RFC_LABEL}`);
  } else {
    execFileSync("gh", ["pr", "edit", String(num), "--repo", repoSlug, "--add-label", RFC_LABEL], {
      stdio: "ignore",
    });
    console.log(`[label-rfc-prs] labeled #${num}`);
  }
}

if (!dryRun) {
  const { cache } = refreshRfcPrStatusCache({ force: true, seedAll: true });
  mkdirSync(dirname(SEED_FILE), { recursive: true });
  writeFileSync(SEED_FILE, `${JSON.stringify(cache, null, 2)}\n`);
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(
    `[label-rfc-prs] wrote ${cache.prs.length} PR status records to src/lib/rfc-pr-status.json`,
  );
}
