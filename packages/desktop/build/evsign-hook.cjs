"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyWindowsSignature } = require("./verify-windows-signature.cjs");

const SIGNED_BASENAMES = new Set([
  "PenguinHarness.exe",
  "elevate.exe",
  "penguin-desktop-win32-x64.exe",
]);

function runEvsign(client, args) {
  return new Promise((resolve, reject) => {
    const failure = () => new Error("Unable to start EVSign.");
    let child;
    try {
      child = childProcess.spawn(client, args, {
        // Vendor output and native errors can contain signing arguments.
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      reject(failure());
      return;
    }
    child.on("error", () => reject(failure()));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("EVSign did not complete successfully."));
    });
  });
}

function createEvsignHook({ certificate, verifySignature = verifyWindowsSignature } = {}) {
  return async function evsign(configuration) {
    const file = path.resolve(configuration.path);
    if ((configuration.hash || "").toLowerCase() !== "sha256") return;
    if (
      file.split(path.sep).includes("git") ||
      (!SIGNED_BASENAMES.has(path.basename(file)) && !file.endsWith(".__uninstaller.exe"))
    )
      return;

    const key = process.env.EVSIGN_KEY;
    if (!key || !key.trim()) {
      if (process.env.EVSIGN_REQUIRE === "true") {
        throw new Error("EVSIGN_KEY is required for Windows release signing.");
      }
      console.log(`[evsign] skip ${path.basename(file)} because EVSIGN_KEY is not configured.`);
      return;
    }
    const client =
      process.env.EVSIGN_CLIENT ||
      path.join(process.env.RUNNER_TEMP || os.tmpdir(), "evsign-client.exe");
    if (!fs.existsSync(client)) throw new Error("EVSign client was not found.");
    const args = [file, "-key", key, "-sha256"];
    if (certificate) args.push("-cert", certificate);
    await runEvsign(client, args);
    // Includes the temporary NSIS uninstaller, which does not survive packaging.
    verifySignature(file);
    console.log(`[evsign] accepted ${path.basename(file)}`);
  };
}

module.exports = { createEvsignHook };
