/**
 * The observability domain's web half: the usage and benchmark pages, compiled by the Web
 * App's program from this package's `./web` entry. The two module classes join the app's own
 * modules in web-root.ts; the host reads the usage trend chart back through this face.
 */
export { UsageModule } from "./usage/module";
export { BenchmarkModule } from "./benchmark/module";
export { TrendChart } from "./usage/trend-chart";
