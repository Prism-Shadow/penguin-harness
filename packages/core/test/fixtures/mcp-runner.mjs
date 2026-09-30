// A stand-in sandbox runner for the stdio MCP tests: sets a marker in the environment and
// runs the server script it was handed, in this process, so what the server reports shows
// it started through the runner.
import { pathToFileURL } from "node:url";

process.env.FIXTURE_SECRET = `via-runner:${process.env.FIXTURE_SECRET ?? ""}`;
await import(pathToFileURL(process.argv[2]).href);
