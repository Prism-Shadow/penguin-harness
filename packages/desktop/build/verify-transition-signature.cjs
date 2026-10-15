"use strict";

const { createRequire } = require("node:module");
const path = require("node:path");
const { verifyWindowsSignature } = require("./verify-windows-signature.cjs");
const updaterRequire = createRequire(require.resolve("electron-updater"));
const { parseDn } = updaterRequire("builder-util-runtime");

// Only this transition candidate must still pass the old client's publisher pin.
function verifyTransitionSignature(file) {
  try {
    const report = verifyWindowsSignature(file);
    const subject = parseDn(report.signer.subject);
    if (
      subject.get("CN") !== "NaisNet Technology Co., Ltd." ||
      subject.get("O") !== "NaisNet Technology Co., Ltd."
    )
      throw new Error("Unexpected transition signer.");
    return report;
  } catch {
    throw new Error(`Transition signature acceptance failed: ${path.basename(file)}`);
  }
}

module.exports = { verifyTransitionSignature };
