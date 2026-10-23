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

function isGitBundleExecutable(file) {
  return file.split(path.sep).includes("git");
}

function shouldSign(file) {
  const base = path.basename(file);
  return SIGNED_BASENAMES.has(base) || base.endsWith(".__uninstaller.exe");
}

function runEvsign(client, file, key) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(client, [file, "-key", key, "-sha256"], {
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`EVSign failed for ${path.basename(file)} with exit code ${code}.`));
    });
  });
}

async function evsign(configuration) {
  const file = path.resolve(configuration.path);
  const requireSigning = process.env.EVSIGN_REQUIRE === "true";
  const key = process.env.EVSIGN_KEY;
  const client =
    process.env.EVSIGN_CLIENT ||
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), "evsign-client.exe");

  if ((configuration.hash || "").toLowerCase() !== "sha256") {
    return;
  }

  if (isGitBundleExecutable(file) || !shouldSign(file)) {
    return;
  }

  if (!key || !key.trim()) {
    if (requireSigning) {
      throw new Error("EVSIGN_KEY is required for Windows release signing.");
    }

    console.log(`[evsign] skip ${path.basename(file)} because no EVSIGN_KEY was given.`);
    return;
  }

  if (!fs.existsSync(client)) {
    throw new Error(`EVSign client was not found at ${client}.`);
  }

  console.log(`[evsign] signing ${path.basename(file)}`);
  await runEvsign(client, file, key);
  // Every signed file is verified here, including NSIS's temporary uninstaller: it does not
  // survive packaging, so this is the only place an unsigned or untimestamped one shows.
  verifyWindowsSignature(file);
}

module.exports = evsign;
module.exports.default = evsign;
