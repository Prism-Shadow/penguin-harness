/**
 * Test fixture standing in for a pushed unified bundle's `cli` export (the thin
 * loader's runHot only ever calls `mod.cli(argv)` — it never inspects `hotPlatform`,
 * so this fixture skips that half entirely). A tiny stand-in commander-free program:
 * `ping` prints and exits 0, anything else exits 42, proving both the happy path and
 * that the hot bundle's own return value becomes the CLI's exit code.
 */
export async function cli(argv) {
  if (argv[0] === "ping") {
    process.stdout.write("pong-from-hot-bundle\n");
    return 0;
  }
  return 42;
}
