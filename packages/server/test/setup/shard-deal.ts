/**
 * Dealing test files into shards by weight: the arithmetic behind weighted-shards.ts, kept free of
 * vitest so a test can run it.
 *
 * Heaviest first, each file to the lightest shard so far (ties go to the lower shard), files of
 * equal weight in path order. The deal depends only on the set of files, never on the order they
 * were listed in, so every job of a sharded run computes the same one and each file runs in
 * exactly one shard. A file the weights do not name (a new one) weighs their median.
 */
export function dealByWeight(
  files: readonly string[],
  count: number,
  weights: Readonly<Record<string, number>>,
): string[][] {
  const known = Object.values(weights).sort((a, b) => a - b);
  const fallback = known[Math.floor(known.length / 2)] ?? 1;
  const weightOf = (file: string): number => weights[file] ?? fallback;
  const order = [...new Set(files)].sort(
    (a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const shards = Array.from({ length: count }, () => ({ load: 0, files: [] as string[] }));
  for (const file of order) {
    let lightest = shards[0]!;
    for (const shard of shards) if (shard.load < lightest.load) lightest = shard;
    lightest.load += weightOf(file);
    lightest.files.push(file);
  }
  return shards.map((shard) => shard.files);
}
