"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$sig = Get-AuthenticodeSignature -LiteralPath $env:PENGUIN_SIGNED_FILE
function Describe-Certificate($cert) {
  if ($null -eq $cert) { return $null }
  return @{ subject = $cert.Subject; issuer = $cert.Issuer; thumbprint = $cert.Thumbprint; notBefore = $cert.NotBefore.ToUniversalTime().ToString('o'); notAfter = $cert.NotAfter.ToUniversalTime().ToString('o') }
}
@{ status = [int]$sig.Status; path = $sig.Path; signer = (Describe-Certificate $sig.SignerCertificate); timestamp = (Describe-Certificate $sig.TimeStamperCertificate) } | ConvertTo-Json -Depth 4 -Compress
`;

// Build-time trust is a valid Authenticode signature plus a timestamp, with no identity pin.
// The certificate facts are reported for the release log, never compared.
function verifyWindowsSignature(file, { allowUnsigned = false } = {}) {
  const failure = () => new Error(`Windows signature acceptance failed: ${path.basename(file)}`);
  if (!path.isAbsolute(file) || file.includes("\0") || !process.env.SystemRoot) throw failure();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !["evsign_key", "psmodulepath", "penguin_signed_file"].includes(key.toLowerCase()),
    ),
  );
  env.PSModulePath = "";
  env.PENGUIN_SIGNED_FILE = file;
  try {
    const stdout = childProcess.execFileSync(
      path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoProfile",
        "-NonInteractive",
        "-InputFormat",
        "None",
        "-EncodedCommand",
        Buffer.from(SCRIPT, "utf16le").toString("base64"),
      ],
      {
        env,
        shell: false,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const report = JSON.parse(stdout.trim());
    if (
      typeof report?.path !== "string" ||
      path.normalize(report.path).toLowerCase() !== path.normalize(file).toLowerCase()
    )
      throw failure();
    if (allowUnsigned && report.status === 2 && !report.signer && !report.timestamp) return report;
    if (report.status !== 0 || report.signer == null || report.timestamp == null) throw failure();
    return report;
  } catch {
    throw failure();
  }
}

module.exports = { verifyWindowsSignature };
