/**
 * A licence text imported whole (`import text from "./LICENSES/x.txt?raw"`), typed for this
 * package's own type check. Every consumer bundles with Vite, whose `vite/client` types declare
 * the same module shape; this file is not part of a consumer's program.
 */
declare module "*.txt?raw" {
  const text: string;
  export default text;
}
